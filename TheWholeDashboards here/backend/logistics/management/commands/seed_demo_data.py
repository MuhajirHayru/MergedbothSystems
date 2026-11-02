import sys
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from logistics.configuration import required_driver_document_types
from logistics.models import (
    DriverApplication,
    DriverDocument,
    DriverProfile,
    DriverShipmentLocation,
    LogisticsUser,
    MarketplaceOrderAuthorization,
    Shipment,
    ShipmentOffer,
)


class Command(BaseCommand):
    help = "Create sample buyer, seller, driver, shipment, and live tracking data for app testing."

    def handle(self, *args, **options):
        if "test" not in sys.argv or settings.MARKETPLACE_INTEGRATION_ENABLED:
            raise CommandError(
                "Synthetic demo records, including verified documents, can only be created by the isolated test suite."
            )
        today = timezone.localdate()

        buyer, _ = LogisticsUser.objects.get_or_create(
            username="demo-buyer",
            defaults={
                "email": "demo-buyer@example.test",
                "password": "Demo-Buyer-2026!",
                "role": LogisticsUser.Role.RETAILER,
                "is_active": True,
                "email_verified": True,
            },
        )
        buyer.set_password("Demo-Buyer-2026!")
        buyer.save(update_fields=["password"])
        seller, _ = LogisticsUser.objects.get_or_create(
            username="demo-seller",
            defaults={
                "email": "demo-seller@example.test",
                "password": "Demo-Seller-2026!",
                "role": LogisticsUser.Role.FARMER,
                "is_active": True,
                "email_verified": True,
            },
        )
        seller.set_password("Demo-Seller-2026!")
        seller.save(update_fields=["password"])
        driver, _ = LogisticsUser.objects.get_or_create(
            username="demo-driver",
            defaults={
                "email": "demo-driver@example.test",
                "password": "Demo-Driver-2026!",
                "role": LogisticsUser.Role.DRIVER,
                "is_active": True,
                "email_verified": True,
            },
        )
        driver.set_password("Demo-Driver-2026!")
        driver.save(update_fields=["password"])
        driver.role = LogisticsUser.Role.DRIVER
        driver.is_active = True
        driver.email_verified = True
        driver.save(update_fields=["role", "is_active", "email_verified"])

        profile, _ = DriverProfile.objects.get_or_create(
            user=driver,
            defaults={
                "phone_number": "+251911223344",
                "preferred_language": DriverProfile.Language.ENGLISH,
            },
        )
        profile.phone_number = "+251911223344"
        profile.preferred_language = DriverProfile.Language.ENGLISH
        profile.save(update_fields=["phone_number", "preferred_language"])

        application, _ = DriverApplication.objects.get_or_create(
            profile=profile,
            defaults={
                "legal_full_name": "Demo Driver",
                "identity_document_type": "national_id",
                "identity_reference": "ID-10001",
                "license_number": "LIC-DEMO-001",
                "license_expiry": today + timedelta(days=365),
                "vehicle_type": "Medium truck",
                "vehicle_registration": "REG-DEMO-001",
                "cargo_capacity_kg": Decimal("1200.00"),
                "service_region": "North",
                "service_zone": "Highland",
                "service_wereda": "Market Wereda",
                "status": DriverApplication.Status.APPROVED,
            },
        )
        application.status = DriverApplication.Status.APPROVED
        application.legal_full_name = "Demo Driver"
        application.identity_document_type = "national_id"
        application.identity_reference = "ID-10001"
        application.license_number = "LIC-DEMO-001"
        application.license_expiry = today + timedelta(days=365)
        application.vehicle_type = "Medium truck"
        application.vehicle_registration = "REG-DEMO-001"
        application.cargo_capacity_kg = Decimal("1200.00")
        application.service_region = "North"
        application.service_zone = "Highland"
        application.service_wereda = "Market Wereda"
        application.save(
            update_fields=[
                "status",
                "legal_full_name",
                "identity_document_type",
                "identity_reference",
                "license_number",
                "license_expiry",
                "vehicle_type",
                "vehicle_registration",
                "cargo_capacity_kg",
                "service_region",
                "service_zone",
                "service_wereda",
            ]
        )

        required_types = required_driver_document_types()
        for document_type in required_types:
            document, _ = DriverDocument.objects.get_or_create(
                application=application,
                document_type=document_type,
                defaults={
                    "file": SimpleUploadedFile(
                        f"{document_type}.txt",
                        b"demo document",
                        content_type="text/plain",
                    ),
                    "verification_status": DriverDocument.VerificationStatus.VERIFIED,
                    "verified_by": None,
                    "expires_at": today + timedelta(days=365),
                    "is_current": True,
                    "uploaded_by": driver,
                },
            )
            document.verification_status = DriverDocument.VerificationStatus.VERIFIED
            document.expires_at = today + timedelta(days=365)
            document.is_current = True
            document.uploaded_by = driver
            document.verification_reason = "Demo data"
            document.save(
                update_fields=[
                    "verification_status",
                    "expires_at",
                    "is_current",
                    "uploaded_by",
                    "verification_reason",
                ]
            )

        order_auth, _ = MarketplaceOrderAuthorization.objects.get_or_create(
            external_order_reference="demo-order-1001",
            defaults={
                "buyer": buyer,
                "seller": seller,
                "status": MarketplaceOrderAuthorization.Status.ELIGIBLE,
            },
        )
        order_auth.buyer = buyer
        order_auth.seller = seller
        order_auth.status = MarketplaceOrderAuthorization.Status.ELIGIBLE
        order_auth.save(update_fields=["buyer", "seller", "status"])

        shipment, _ = Shipment.objects.get_or_create(
            buyer=buyer,
            external_order_reference="demo-order-1001",
            defaults={
                "seller": seller,
                "assigned_driver": driver,
                "order_verified": True,
                "pickup_region": "North",
                "pickup_zone": "Highland",
                "pickup_wereda": "Market Wereda",
                "pickup_address": "North Produce Hub, Highland",
                "destination_region": "North",
                "destination_zone": "Highland",
                "destination_wereda": "City Center",
                "destination_address": "GreenPath Depot, Addis Ababa",
                "product_summary": "Fresh oranges",
                "cargo_weight_kg": Decimal("950.00"),
                "handling_requirements": "Keep refrigerated away from direct sun",
                "status": Shipment.Status.ASSIGNED,
                "currency": "ETB",
            },
        )
        shipment.seller = seller
        shipment.assigned_driver = driver
        shipment.order_verified = True
        shipment.pickup_region = "North"
        shipment.pickup_zone = "Highland"
        shipment.pickup_wereda = "Market Wereda"
        shipment.pickup_address = "North Produce Hub, Highland"
        shipment.destination_region = "North"
        shipment.destination_zone = "Highland"
        shipment.destination_wereda = "City Center"
        shipment.destination_address = "GreenPath Depot, Addis Ababa"
        shipment.product_summary = "Fresh oranges"
        shipment.cargo_weight_kg = Decimal("950.00")
        shipment.handling_requirements = "Keep refrigerated away from direct sun"
        shipment.status = Shipment.Status.ASSIGNED
        shipment.currency = "ETB"
        shipment.save(
            update_fields=[
                "seller",
                "assigned_driver",
                "order_verified",
                "pickup_region",
                "pickup_zone",
                "pickup_wereda",
                "pickup_address",
                "destination_region",
                "destination_zone",
                "destination_wereda",
                "destination_address",
                "product_summary",
                "cargo_weight_kg",
                "handling_requirements",
                "status",
                "currency",
            ]
        )

        DriverShipmentLocation.objects.filter(shipment=shipment).delete()

        ShipmentOffer.objects.get_or_create(
            shipment=shipment,
            driver=driver,
            defaults={
                "status": ShipmentOffer.Status.ACCEPTED,
                "expires_at": timezone.now() + timedelta(days=1),
            },
        )

        self.stdout.write(
            self.style.SUCCESS(
                "Seeded demo data: buyer=%s seller=%s driver=%s shipment=%s"
                % (buyer.username, seller.username, driver.username, shipment.pk)
            )
        )
