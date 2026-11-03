"""Part 26 — freight bidding APIs.

Driver side (port 3000, driver role):
- GET  /api/v1/logistics/freight-jobs/          open job board (Uber-style)
- POST /api/v1/logistics/freight-jobs/<id>/bid/ place or update a bid
- GET  /api/v1/logistics/freight-jobs/my-bids/  own bids
- POST /api/v1/logistics/freight-jobs/<id>/withdraw/

Staff side (LOGISTICS_MANAGER / SUPER_ADMIN — the logistics tracker controls everything):
- GET  /api/v1/payments/financial/freight-jobs/ all jobs with bids
- POST /api/v1/payments/financial/freight-jobs/<id>/assign/ accept a bid
- POST /api/v1/payments/financial/freight-jobs/<id>/cancel/
"""

import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.services import notify
from users.audit import log_action
from users.models import Role
from rest_framework.permissions import IsAuthenticated
from users.permissions import IsAuthenticatedRole

from .freight_models import FreightBid, FreightJob
from .freight_services import assign_bid, place_bid, withdraw_bid


def _job_row(job):
    bids = [
        {
            "id": str(b.pk),
            "driver": b.driver.full_name,
            "driver_id": str(b.driver_id),
            "amount": str(b.amount),
            "estimated_hours": b.estimated_hours,
            "message": b.message,
            "status": b.status,
            "created_at": b.created_at.isoformat(),
        }
        for b in job.bids.all()
    ]
    return {
        "id": str(job.pk),
        "order_reference": job.order.reference,
        "product": job.order.product.title,
        "quantity": str(job.order.quantity),
        "buyer": job.order.buyer.full_name,
        "pickup": job.pickup_summary,
        "destination": job.destination_summary,
        "cargo_weight_kg": str(job.cargo_weight_kg) if job.cargo_weight_kg else None,
        "packaging": job.packaging_details,
        "status": job.status,
        "assigned_driver": job.assigned_driver.full_name if job.assigned_driver else None,
        "assigned_fee": str(job.assigned_fee) if job.assigned_fee else None,
        "exact_pickup_address": job.exact_pickup_address,
        "exact_destination_address": job.exact_destination_destination if hasattr(job, "exact_destination_destination") else job.exact_destination_address,
        "published_at": job.published_at.isoformat(),
        "bid_count": len(bids),
        "bids": bids,
    }


class FreightJobBoardView(APIView):
    """Driver job board — open jobs only."""

    def get_permissions(self):
        return [IsAuthenticatedRole((Role.DRIVER,))]

    def get(self, request):
        jobs = FreightJob.objects.filter(status=FreightJob.Status.OPEN).select_related(
            "order", "order__product"
        )
        my_bids = {
            b.job_id: b for b in FreightBid.objects.filter(
                driver=request.user, job__in=jobs
            )
        }
        return Response({
            "success": True,
            "jobs": [
                {
                    **_job_row(job),
                    "my_bid": (
                        {"amount": str(my_bids[job.pk].amount),
                         "status": my_bids[job.pk].status}
                        if job.pk in my_bids else None
                    ),
                }
                for job in jobs
            ],
        })


class FreightBidView(APIView):
    def get_permissions(self):
        return [IsAuthenticatedRole((Role.DRIVER,))]

    def post(self, request, pk):
        bid = place_bid(
            driver=request.user,
            job_id=pk,
            amount=request.data.get("amount"),
            estimated_hours=request.data.get("estimated_hours", 24),
            message=request.data.get("message", ""),
        )
        return Response({
            "success": True,
            "bid": {"id": str(bid.pk), "amount": str(bid.amount),
                    "estimated_hours": bid.estimated_hours, "status": bid.status},
        }, status=201)

    def delete(self, request, pk):
        withdraw_bid(driver=request.user, job_id=pk)
        return Response({"success": True})


class MyFreightBidsView(APIView):
    def get_permissions(self):
        return [IsAuthenticatedRole((Role.DRIVER,))]

    def get(self, request):
        bids = FreightBid.objects.filter(driver=request.user).select_related("job", "job__order")
        return Response({
            "success": True,
            "bids": [
                {
                    "id": str(b.pk),
                    "job_id": str(b.job_id),
                    "order_reference": b.job.order.reference,
                    "pickup": b.job.pickup_summary,
                    "destination": b.job.destination_summary,
                    "amount": str(b.amount),
                    "estimated_hours": b.estimated_hours,
                    "status": b.status,
                    "job_status": b.job.status,
                    "created_at": b.created_at.isoformat(),
                }
                for b in bids
            ],
        })


class StaffFreightJobsView(APIView):
    """The logistics tracker's control board: every job, every bid, full control."""

    def get_permissions(self):
        return [IsAuthenticatedRole((Role.SUPER_ADMIN, Role.LOGISTICS_MANAGER))]

    def get(self, request):
        jobs = FreightJob.objects.select_related("order", "order__product", "assigned_driver").order_by("-published_at")
        status_param = request.query_params.get("status")
        if status_param:
            jobs = jobs.filter(status=status_param)
        return Response({
            "success": True,
            "summary": {
                "open": jobs.filter(status=FreightJob.Status.OPEN).count(),
                "assigned": jobs.filter(status=FreightJob.Status.ASSIGNED).count(),
                "completed": jobs.filter(status=FreightJob.Status.COMPLETED).count(),
                "cancelled": jobs.filter(status=FreightJob.Status.CANCELLED).count(),
            },
            "jobs": [_job_row(j) for j in jobs[:100]],
        })


class StaffFreightAssignView(APIView):
    def get_permissions(self):
        return [IsAuthenticatedRole((Role.SUPER_ADMIN, Role.LOGISTICS_MANAGER))]

    def post(self, request, pk):
        bid_id = request.data.get("bid_id")
        job, bid = assign_bid(staff=request.user, job_id=pk, bid_id=bid_id)
        log_action(
            request, actor=request.user, action="freight_job_assigned",
            target=job.order.reference,
            detail=f"Bid {bid_id} accepted at {bid.amount} ETB for driver {bid.driver.full_name}.",
        )
        return Response({"success": True, "job": _job_row(job)})


class StaffFreightCancelView(APIView):
    def get_permissions(self):
        return [IsAuthenticatedRole((Role.SUPER_ADMIN, Role.LOGISTICS_MANAGER))]

    def post(self, request, pk):
        job = FreightJob.objects.select_for_update().filter(pk=pk).first()
        if job is None:
            return Response({"success": False, "error": "Freight job not found."}, status=404)
        if job.status != FreightJob.Status.OPEN:
            return Response({"success": False, "error": "Only open jobs can be cancelled."}, status=400)
        job.status = FreightJob.Status.CANCELLED
        job.save(update_fields=["status", "updated_at"])
        FreightBid.objects.filter(job=job, status=FreightBid.Status.SUBMITTED).update(
            status=FreightBid.Status.WITHDRAWN, responded_at=timezone.now()
        )
        log_action(request, actor=request.user, action="freight_job_cancelled",
                   target=job.order.reference,
                   detail=(request.data.get("reason") or "").strip())
        return Response({"success": True, "job": _job_row(job)})


class MyAssignmentsView(APIView):
    """GET /api/logistics/freight-jobs/my-assignments/ — Part 10.

    The assigned driver's view of their deliveries. Exact seller pickup and
    buyer destination addresses are included ONLY for jobs assigned to the
    requesting driver, only after backend-confirmed assignment. Unassigned
    drivers and unrelated users can never reach another delivery's addresses.
    """

    def get_permissions(self):
        return [IsAuthenticatedRole((Role.DRIVER,))]

    def get(self, request):
        jobs = FreightJob.objects.filter(
            assigned_driver=request.user,
            status__in=(FreightJob.Status.ASSIGNED, FreightJob.Status.COMPLETED),
        ).select_related("order", "order__product", "order__wholesaler", "order__farmer", "order__retailer")
        assignments = []
        for job in jobs:
            order = job.order
            seller = order.seller
            buyer = order.buyer
            # Contact info only for the assigned driver, per Part 10 authorization.
            assignments.append({
                "job_id": str(job.pk),
                "order_reference": order.reference,
                "product": order.product.title,
                "quantity": str(order.quantity),
                "cargo_weight_kg": str(job.cargo_weight_kg) if job.cargo_weight_kg else None,
                "packaging": job.packaging_details,
                "status": job.status,
                "assigned_at": job.assigned_at.isoformat() if job.assigned_at else None,
                "my_fee": str(job.assigned_fee) if job.assigned_fee else None,
                "addresses_disclosed": bool(job.addresses_disclosed_at),
                "seller": {
                    "name": seller.full_name if seller else None,
                    "pickup_address": job.exact_pickup_address or None,
                },
                "buyer": {
                    "name": buyer.full_name if buyer else None,
                    "delivery_address": job.exact_destination_address or None,
                },
            })
        return Response({"success": True, "assignments": assignments})
