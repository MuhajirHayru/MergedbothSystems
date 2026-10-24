import hashlib
import hmac
import json
import time
import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.storage import InMemoryStorage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient

from .assistant_provider import AssistantProviderError
from .models import (
    AuditEvent,
    DriverApplication,
    DriverApplicationReview,
    DriverDocument,
    DriverProfile,
    DriverShipmentLocation,
    LogisticsUser,
    MarketplaceDriverIdentity,
    MarketplaceDeliveryFeeReview,
    MarketplaceIntegrationEvent,
    MarketplaceOrderAuthorization,
    MarketplacePaymentSnapshot,
    MarketplaceShipmentEvent,
    Shipment,
    ShipmentConversationRead,
    ShipmentEvidence,
    ShipmentException,
    ShipmentFeeAgreement,
    ShipmentFeeProposal,
    ShipmentMessage,
    ShipmentNotification,
    ShipmentOffer,
    ShipmentTransition,
    SystemSetting,
)
from .services import expire_driver_applications
from .shipment_services import authorize_marketplace_order, eligible_driver_applications


def create_user(username, role, **kwargs):
    return LogisticsUser.objects.create_user(
        username=username,
        email=f"{username}@example.test",
        password="Unique-GreenPath-2026!",
        role=role,
        **kwargs,
    )


def create_application(username, status=DriverApplication.Status.DRAFT, **app_values):
    user = create_user(username, LogisticsUser.Role.DRIVER)
    profile = DriverProfile.objects.create(
        user=user,
        phone_number="+251900000001",
        preferred_language=DriverProfile.Language.ENGLISH,
    )
    values = {
        "legal_full_name": f"{username.title()} Driver",
        "license_number": f"LIC-{username}",
        "license_expiry": timezone.localdate() + timedelta(days=365),
        "vehicle_type": "Small truck",
        "vehicle_registration": f"REG-{username}",
        "cargo_capacity_kg": "1200.00",
        "service_region": "North",
        "service_zone": "Highland",
        "service_wereda": "Market Wereda",
        "status": status,
    }
    values.update(app_values)
    application = DriverApplication.objects.create(profile=profile, **values)
    return user, application


class PrivateStorageTestMixin:
    def setUp(self):
        super().setUp()
        self.private_file_fields = (
            DriverDocument._meta.get_field("file"),
            ShipmentEvidence._meta.get_field("file"),
        )
        self.original_private_storages = tuple(
            field.storage for field in self.private_file_fields
        )
        test_storage = InMemoryStorage()
        for field in self.private_file_fields:
            field.storage = test_storage
        self.addCleanup(self.cleanup_private_storage)

    def cleanup_private_storage(self):
        for field, storage in zip(
            self.private_file_fields, self.original_private_storages
        ):
            field.storage = storage


class HealthEndpointTests(TestCase):
    def test_health_reports_database_connectivity(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "database": "ok"})

    def test_api_schema_and_swagger_docs_remain_public(self):
        schema = self.client.get(
            "/api/schema/", HTTP_ACCEPT="application/vnd.oai.openapi+json"
        )
        docs = self.client.get("/api/docs/")

        self.assertEqual(schema.status_code, 200)
        self.assertEqual(docs.status_code, 200)
        paths = schema.json()["paths"]
        self.assertEqual(paths["/api/shipments/"]["get"]["operationId"], "shipment_list")
        self.assertEqual(paths["/api/shipments/"]["post"]["operationId"], "shipment_create")
        self.assertEqual(
            paths["/api/shipments/{shipment_id}/"]["get"]["operationId"],
            "shipment_retrieve",
        )


class FoundationModelTests(TestCase):
    def test_external_identity_can_be_mapped_to_logistics_user(self):
        user = LogisticsUser.objects.create_user(
            username="farmer-one",
            password="test-password",
            role=LogisticsUser.Role.FARMER,
            external_user_id="marketplace-user-123",
        )

        self.assertEqual(user.external_user_id, "marketplace-user-123")
        self.assertEqual(user.role, LogisticsUser.Role.FARMER)

    def test_system_setting_stores_structured_values(self):
        setting = SystemSetting.objects.create(
            key="driver-offer-policy", value={"expiry_minutes": 15}
        )

        self.assertEqual(setting.value["expiry_minutes"], 15)


@override_settings(MARKETPLACE_INTEGRATION_ENABLED=False)
class SeedDemoDataCommandTests(PrivateStorageTestMixin, TestCase):
    def test_seed_demo_data_refuses_non_test_execution(self):
        with patch(
            "logistics.management.commands.seed_demo_data.sys.argv",
            ["manage.py", "seed_demo_data"],
        ):
            with self.assertRaises(CommandError):
                call_command("seed_demo_data")

    def test_seed_demo_data_creates_demo_buyer_seller_driver_and_tracking_flow(self):
        call_command("seed_demo_data")
        call_command("seed_demo_data")

        buyer = LogisticsUser.objects.get(username="demo-buyer")
        seller = LogisticsUser.objects.get(username="demo-seller")
        driver = LogisticsUser.objects.get(username="demo-driver")

        self.assertEqual(buyer.role, LogisticsUser.Role.RETAILER)
        self.assertEqual(seller.role, LogisticsUser.Role.FARMER)
        self.assertEqual(driver.role, LogisticsUser.Role.DRIVER)
        self.assertTrue(driver.is_active)
        self.assertTrue(buyer.check_password("Demo-Buyer-2026!"))
        self.assertTrue(seller.check_password("Demo-Seller-2026!"))
        self.assertTrue(driver.check_password("Demo-Driver-2026!"))

        application = driver.driver_profile.application
        self.assertEqual(application.status, DriverApplication.Status.APPROVED)
        self.assertEqual(application.service_region, "North")
        self.assertEqual(application.documents.filter(is_current=True).count(), 3)

        shipment = Shipment.objects.get(buyer=buyer, assigned_driver=driver)
        self.assertTrue(shipment.order_verified)
        self.assertEqual(shipment.status, Shipment.Status.ASSIGNED)
        self.assertTrue(
            MarketplaceOrderAuthorization.objects.filter(
                buyer=buyer,
                seller=seller,
                status=MarketplaceOrderAuthorization.Status.ELIGIBLE,
            ).exists()
        )
        self.assertFalse(DriverShipmentLocation.objects.filter(shipment=shipment).exists())


@override_settings(MARKETPLACE_INTEGRATION_ENABLED=False)
class AuthenticationApiTests(TestCase):
    def test_unauthenticated_profile_is_401(self):
        response = self.client.get("/api/auth/me/")

        self.assertEqual(response.status_code, 401)

    def test_registration_always_creates_only_a_driver_and_requires_activation(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "username": "new-driver",
                "email": "new-driver@example.test",
                "password": "Genuine-Random-Driver-Password-839!",
                "legal_full_name": "New Driver",
                "phone_number": "+251911111111",
                "preferred_language": "en",
                "role": "super_admin",
                "is_staff": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        user = LogisticsUser.objects.get(username="new-driver")
        self.assertEqual(user.role, LogisticsUser.Role.DRIVER)
        self.assertFalse(user.is_staff)
        self.assertTrue(user.check_password("Genuine-Random-Driver-Password-839!"))
        self.assertEqual(user.driver_profile.application.status, DriverApplication.Status.DRAFT)
        self.assertFalse(user.is_active)
        self.assertNotIn("password", response.data)
        activation = response.data["development_activation"]
        activated = self.client.post(
            "/api/auth/activate/",
            activation,
            format="json",
        )
        self.assertEqual(activated.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        self.assertTrue(user.is_active)
        self.assertEqual(activated.data["role"], LogisticsUser.Role.DRIVER)

    def test_unactivated_account_cannot_sign_in(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "username": "pending-driver",
                "email": "pending-driver@example.test",
                "password": "Genuine-Random-Driver-Password-839!",
                "legal_full_name": "Pending Driver",
                "phone_number": "+251911111112",
                "preferred_language": "en",
            },
            format="json",
        )
        login_response = self.client.post(
            "/api/auth/login/",
            {
                "username": "pending-driver",
                "password": "Genuine-Random-Driver-Password-839!",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(login_response.status_code, 401)

    def test_login_logout_and_csrf_protection(self):
        user = create_user("session-driver", LogisticsUser.Role.DRIVER)
        client = APIClient(enforce_csrf_checks=True)

        denied = client.post(
            "/api/auth/login/",
            {"username": user.username, "password": "Unique-GreenPath-2026!"},
            format="json",
        )
        self.assertEqual(denied.status_code, 403)

        csrf = client.get("/api/auth/csrf/").data["csrf_token"]
        logged_in = client.post(
            "/api/auth/login/",
            {"username": user.username, "password": "Unique-GreenPath-2026!"},
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(logged_in.status_code, 200)
        self.assertEqual(client.get("/api/auth/me/").data["id"], user.pk)

        csrf = client.get("/api/auth/csrf/").data["csrf_token"]
        logged_out = client.post(
            "/api/auth/logout/", {}, format="json", HTTP_X_CSRFTOKEN=csrf
        )
        self.assertEqual(logged_out.status_code, 204)
        self.assertEqual(client.get("/api/auth/me/").status_code, 401)

    def test_password_reset_is_one_time_and_password_is_hashed(self):
        user = create_user("reset-driver", LogisticsUser.Role.DRIVER)
        response = self.client.post(
            "/api/auth/password-reset/",
            {"email": user.email},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        reset = response.data["development_reset"]

        confirmed = self.client.post(
            "/api/auth/password-reset/confirm/",
            {
                "uid": reset["uid"],
                "token": reset["token"],
                "new_password": "A-New-Unique-Password-2026!",
            },
            format="json",
        )
        self.assertEqual(confirmed.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password("A-New-Unique-Password-2026!"))
        self.assertEqual(
            self.client.post(
                "/api/auth/password-reset/confirm/",
                {
                    "uid": reset["uid"],
                    "token": reset["token"],
                    "new_password": "Another-Unique-Password-2026!",
                },
                format="json",
            ).status_code,
            400,
        )

    @override_settings(PASSWORD_RESET_DEBUG_DELIVERY=False)
    @patch("logistics.auth_views.send_mail", side_effect=OSError("mail offline"))
    def test_password_reset_delivery_failure_does_not_reveal_account_existence(
        self, send_mail_mock
    ):
        user = create_user("mail-failure-driver", LogisticsUser.Role.DRIVER)

        known_account = self.client.post(
            "/api/auth/password-reset/", {"email": user.email}, format="json"
        )
        unknown_account = self.client.post(
            "/api/auth/password-reset/",
            {"email": "unknown@example.test"},
            format="json",
        )

        self.assertEqual(known_account.status_code, 200)
        self.assertEqual(unknown_account.status_code, 200)
        self.assertEqual(known_account.data, unknown_account.data)
        self.assertNotIn("development_reset", known_account.data)
        self.assertEqual(send_mail_mock.call_count, 1)
        self.assertTrue(
            AuditEvent.objects.filter(
                action="auth.password_reset_delivery_failed"
            ).exists()
        )


@override_settings(MARKETPLACE_INTEGRATION_ENABLED=False)
class DriverApplicationApiTests(PrivateStorageTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.driver, self.application = create_application("owner-driver")
        self.other_driver, self.other_application = create_application("other-driver")
        self.client = APIClient()

    def test_only_driver_role_can_use_driver_application_api(self):
        allowed = self.client.get("/api/drivers/me/application/")
        self.assertEqual(allowed.status_code, 401)

        for role in [
            LogisticsUser.Role.FARMER,
            LogisticsUser.Role.WHOLESALER,
            LogisticsUser.Role.RETAILER,
            LogisticsUser.Role.FINANCIAL_MANAGER,
            LogisticsUser.Role.ADMINISTRATOR,
            LogisticsUser.Role.SUPER_ADMIN,
            LogisticsUser.Role.TOP_USER_ADMIN,
            LogisticsUser.Role.REGIONAL_ADMIN,
            LogisticsUser.Role.ZONAL_ADMIN,
            LogisticsUser.Role.WEREDA_ADMIN,
        ]:
            user = create_user(f"role-{role}", role)
            self.client.force_authenticate(user=user)
            response = self.client.get("/api/drivers/me/application/")
            self.assertEqual(response.status_code, 403, role)

        self.client.force_authenticate(user=self.driver)
        response = self.client.get("/api/drivers/me/application/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], self.application.pk)

    def test_driver_cannot_write_privileged_status_fields(self):
        self.client.force_authenticate(user=self.driver)
        response = self.client.patch(
            "/api/drivers/me/application/",
            {"status": "approved", "reviewer": self.other_driver.pk},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, DriverApplication.Status.DRAFT)
        self.assertIsNone(self.application.reviewer_id)

    def test_submitted_verified_information_is_locked(self):
        self.application.status = DriverApplication.Status.SUBMITTED
        self.application.save(update_fields=["status"])
        self.client.force_authenticate(user=self.driver)

        response = self.client.patch(
            "/api/drivers/me/application/",
            {"legal_full_name": "Changed Name"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    @override_settings(MARKETPLACE_INTEGRATION_ENABLED=True)
    def test_marketplace_owns_driver_application_changes_when_integrated(self):
        self.client.force_authenticate(user=self.driver)

        edited = self.client.patch(
            "/api/drivers/me/application/",
            {"legal_full_name": "Unapproved Local Change"},
            format="json",
        )
        submitted = self.client.post(
            "/api/drivers/me/application/submit/", {}, format="json"
        )
        uploaded = self.client.post(
            "/api/drivers/me/application/documents/",
            {
                "document_type": "identity",
                "file": SimpleUploadedFile("identity.pdf", b"%PDF-1.4 identity"),
            },
            format="multipart",
        )

        self.assertEqual(edited.status_code, 403)
        self.assertEqual(submitted.status_code, 403)
        self.assertEqual(uploaded.status_code, 403)
        self.application.refresh_from_db()
        self.assertEqual(self.application.legal_full_name, "Owner-Driver Driver")
        self.assertFalse(self.application.documents.exists())

    @override_settings(
        DRIVER_DOCUMENT_TYPES=["identity"],
        DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
        DRIVER_DOCUMENT_MAX_BYTES=128,
    )
    def test_upload_validation_and_application_submission(self):
        self.client.force_authenticate(user=self.driver)
        upload_url = "/api/drivers/me/application/documents/"

        invalid = self.client.post(
            upload_url,
            {
                "document_type": "identity",
                "file": SimpleUploadedFile("proof.pdf", b"not a pdf"),
            },
            format="multipart",
        )
        self.assertEqual(invalid.status_code, 400)

        oversized = self.client.post(
            upload_url,
            {
                "document_type": "identity",
                "file": SimpleUploadedFile("proof.pdf", b"%PDF-1.4" + b"x" * 200),
            },
            format="multipart",
        )
        self.assertEqual(oversized.status_code, 400)

        uploaded = self.client.post(
            upload_url,
            {
                "document_type": "identity",
                "file": SimpleUploadedFile("proof.pdf", b"%PDF-1.4 test content"),
            },
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 201)
        self.assertTrue(uploaded.data["id"])

        submitted = self.client.post(
            "/api/drivers/me/application/submit/", {}, format="json"
        )
        self.assertEqual(submitted.status_code, 200)
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, DriverApplication.Status.SUBMITTED)
        self.assertTrue(self.application.submitted_at)
        self.assertTrue(
            DriverApplicationReview.objects.filter(
                application=self.application,
                to_status=DriverApplication.Status.SUBMITTED,
            ).exists()
        )
        self.assertTrue(
            AuditEvent.objects.filter(
                action="driver_application.submitted", object_id=str(self.application.pk)
            ).exists()
        )

    def test_submission_without_required_documents_is_rejected(self):
        self.client.force_authenticate(user=self.driver)
        response = self.client.post(
            "/api/drivers/me/application/submit/", {}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, DriverApplication.Status.DRAFT)


@override_settings(MARKETPLACE_INTEGRATION_ENABLED=False)
class ReviewerApiTests(PrivateStorageTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.north_driver, self.north_application = create_application(
            "north-driver", status=DriverApplication.Status.SUBMITTED
        )
        self.south_driver, self.south_application = create_application(
            "south-driver",
            status=DriverApplication.Status.SUBMITTED,
            service_region="South",
            service_zone="Valley",
            service_wereda="River Wereda",
        )
        self.client = APIClient()

    def test_role_matrix_for_application_review_queue(self):
        reviewer_roles = [
            LogisticsUser.Role.SUPER_ADMIN,
            LogisticsUser.Role.TOP_USER_ADMIN,
            LogisticsUser.Role.REGIONAL_ADMIN,
            LogisticsUser.Role.ZONAL_ADMIN,
            LogisticsUser.Role.WEREDA_ADMIN,
        ]
        denied_roles = [
            LogisticsUser.Role.DRIVER,
            LogisticsUser.Role.FARMER,
            LogisticsUser.Role.WHOLESALER,
            LogisticsUser.Role.RETAILER,
            LogisticsUser.Role.FINANCIAL_MANAGER,
            LogisticsUser.Role.ADMINISTRATOR,
        ]
        for index, role in enumerate(reviewer_roles):
            kwargs = {}
            if role == LogisticsUser.Role.REGIONAL_ADMIN:
                kwargs = {"admin_region": "North"}
            elif role == LogisticsUser.Role.ZONAL_ADMIN:
                kwargs = {"admin_region": "North", "admin_zone": "Highland"}
            elif role == LogisticsUser.Role.WEREDA_ADMIN:
                kwargs = {
                    "admin_region": "North",
                    "admin_zone": "Highland",
                    "admin_wereda": "Market Wereda",
                }
            user = create_user(f"reviewer-{index}", role, **kwargs)
            self.client.force_authenticate(user=user)
            response = self.client.get("/api/admin/driver-applications/")
            self.assertEqual(response.status_code, 200, role)
            if role in {
                LogisticsUser.Role.REGIONAL_ADMIN,
                LogisticsUser.Role.ZONAL_ADMIN,
                LogisticsUser.Role.WEREDA_ADMIN,
            }:
                self.assertEqual(response.data["count"], 1)
            else:
                self.assertEqual(response.data["count"], 2)

        for index, role in enumerate(denied_roles):
            user = create_user(f"non-reviewer-{index}", role)
            self.client.force_authenticate(user=user)
            self.assertEqual(
                self.client.get("/api/admin/driver-applications/").status_code,
                403,
                role,
            )

    @override_settings(DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"])
    def test_approval_requires_verified_document_and_records_audit(self):
        reviewer = create_user("global-reviewer", LogisticsUser.Role.TOP_USER_ADMIN)
        document = DriverDocument.objects.create(
            application=self.north_application,
            document_type="identity",
            file="driver-documents/test/identity.pdf",
            uploaded_by=self.north_driver,
        )
        self.client.force_authenticate(user=reviewer)
        review_url = f"/api/admin/driver-applications/{self.north_application.pk}/review/"
        queued = self.client.post(
            review_url,
            {"status": "under_review", "reason": "Beginning verification."},
            format="json",
        )
        self.assertEqual(queued.status_code, 200)
        payload = {"status": "approved", "reason": "All checks completed."}

        denied = self.client.post(review_url, payload, format="json")
        self.assertEqual(denied.status_code, 400)

        verify = self.client.post(
            f"/api/admin/driver-documents/{document.pk}/verify/",
            {"verification_status": "verified", "reason": "Document is legible."},
            format="json",
        )
        self.assertEqual(verify.status_code, 200)
        approved = self.client.post(review_url, payload, format="json")
        self.assertEqual(approved.status_code, 200)
        self.north_application.refresh_from_db()
        self.assertEqual(self.north_application.status, DriverApplication.Status.APPROVED)
        self.assertEqual(self.north_application.reviewer_id, reviewer.pk)
        self.assertTrue(
            AuditEvent.objects.filter(
                actor=reviewer,
                action="driver_application.reviewed",
                object_id=str(self.north_application.pk),
            ).exists()
        )

    def test_invalid_transition_and_self_approval_are_denied(self):
        reviewer = create_user("self-reviewer", LogisticsUser.Role.SUPER_ADMIN)
        self.north_driver.role = LogisticsUser.Role.SUPER_ADMIN
        self.north_driver.save(update_fields=["role"])
        self.client.force_authenticate(user=self.north_driver)
        own_review = self.client.post(
            f"/api/admin/driver-applications/{self.north_application.pk}/review/",
            {"status": "approved", "reason": "Self review"},
            format="json",
        )
        self.assertEqual(own_review.status_code, 403)

        self.client.force_authenticate(user=reviewer)
        invalid = self.client.post(
            f"/api/admin/driver-applications/{self.south_application.pk}/review/",
            {"status": "approved", "reason": "Cannot skip review"},
            format="json",
        )
        self.assertEqual(invalid.status_code, 400)

    @override_settings(MARKETPLACE_INTEGRATION_ENABLED=True)
    def test_marketplace_owns_driver_review_and_document_verification_when_integrated(self):
        reviewer = create_user("marketplace-reviewer", LogisticsUser.Role.SUPER_ADMIN)
        document = DriverDocument.objects.create(
            application=self.north_application,
            document_type="identity",
            file="driver-documents/test/identity.pdf",
            uploaded_by=self.north_driver,
        )
        self.client.force_authenticate(user=reviewer)

        self.assertEqual(
            self.client.get("/api/admin/driver-applications/").status_code, 403
        )
        review = self.client.post(
            f"/api/admin/driver-applications/{self.north_application.pk}/review/",
            {"status": "under_review", "reason": "Local review attempt."},
            format="json",
        )
        verification = self.client.post(
            f"/api/admin/driver-documents/{document.pk}/verify/",
            {"verification_status": "verified", "reason": "Local verification attempt."},
            format="json",
        )
        self.assertEqual(review.status_code, 403)
        self.assertEqual(verification.status_code, 403)
        self.north_application.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(self.north_application.status, DriverApplication.Status.SUBMITTED)
        self.assertEqual(
            document.verification_status, DriverDocument.VerificationStatus.PENDING
        )

    def test_regional_admin_cannot_read_out_of_scope_application(self):
        reviewer = create_user(
            "north-reviewer",
            LogisticsUser.Role.REGIONAL_ADMIN,
            admin_region="North",
        )
        self.client.force_authenticate(user=reviewer)

        self.assertEqual(
            self.client.get(
                f"/api/admin/driver-applications/{self.north_application.pk}/"
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                f"/api/admin/driver-applications/{self.south_application.pk}/"
            ).status_code,
            404,
        )

    def test_suspension_deactivates_account_and_blocks_login(self):
        self.north_application.status = DriverApplication.Status.APPROVED
        self.north_application.save(update_fields=["status"])
        reviewer = create_user("suspension-reviewer", LogisticsUser.Role.TOP_USER_ADMIN)
        self.client.force_authenticate(user=reviewer)

        response = self.client.post(
            f"/api/admin/driver-applications/{self.north_application.pk}/review/",
            {"status": "suspended", "reason": "Safety investigation."},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.north_driver.refresh_from_db()
        self.assertFalse(self.north_driver.is_active)

        login_response = self.client.post(
            "/api/auth/login/",
            {"username": self.north_driver.username, "password": "Unique-GreenPath-2026!"},
            format="json",
        )
        self.assertEqual(login_response.status_code, 401)

        reinstated = self.client.post(
            f"/api/admin/driver-applications/{self.north_application.pk}/review/",
            {"status": "under_review", "reason": "Investigation cleared."},
            format="json",
        )
        self.assertEqual(reinstated.status_code, 200)
        self.north_application.refresh_from_db()
        self.north_driver.refresh_from_db()
        self.assertEqual(
            self.north_application.status, DriverApplication.Status.UNDER_REVIEW
        )
        self.assertTrue(self.north_driver.is_active)


@override_settings(MARKETPLACE_INTEGRATION_ENABLED=False)
class DriverExpiryTests(TestCase):
    def test_expired_license_deactivates_driver_and_records_history(self):
        driver, application = create_application(
            "expired-license-driver",
            status=DriverApplication.Status.APPROVED,
            license_expiry=timezone.localdate() - timedelta(days=1),
        )

        count = expire_driver_applications()

        self.assertEqual(count, 1)
        application.refresh_from_db()
        driver.refresh_from_db()
        self.assertEqual(application.status, DriverApplication.Status.EXPIRED)
        self.assertFalse(driver.is_active)
        self.assertTrue(
            DriverApplicationReview.objects.filter(
                application=application,
                from_status=DriverApplication.Status.APPROVED,
                to_status=DriverApplication.Status.EXPIRED,
            ).exists()
        )
        self.assertTrue(
            AuditEvent.objects.filter(
                action="driver_application.expired", object_id=str(application.pk)
            ).exists()
        )


@override_settings(MARKETPLACE_INTEGRATION_ENABLED=False)
class PrivateDocumentAccessTests(PrivateStorageTestMixin, TestCase):
    @override_settings(DRIVER_DOCUMENT_TYPES=["identity"], DRIVER_DOCUMENT_MAX_BYTES=1024)
    def test_download_is_private_to_owner_and_in_scope_reviewers(self):
        owner, application = create_application("document-owner")
        reviewer = create_user(
            "document-reviewer",
            LogisticsUser.Role.REGIONAL_ADMIN,
            admin_region="North",
        )
        outsider = create_user("document-outsider", LogisticsUser.Role.FINANCIAL_MANAGER)
        document = DriverDocument.objects.create(
            application=application,
            document_type="identity",
            file=SimpleUploadedFile("private.pdf", b"%PDF-1.4 private evidence"),
            uploaded_by=owner,
        )
        url = f"/api/driver-documents/{document.pk}/download/"
        client = APIClient()

        self.assertEqual(client.get(url).status_code, 401)

        client.force_authenticate(user=owner)
        owner_response = client.get(url)
        self.assertEqual(owner_response.status_code, 200)
        self.assertEqual(owner_response["Content-Type"], "application/octet-stream")
        self.assertEqual(owner_response["X-Content-Type-Options"], "nosniff")
        owner_response.close()

        client.force_authenticate(user=reviewer)
        reviewer_response = client.get(url)
        self.assertEqual(reviewer_response.status_code, 200)
        reviewer_response.close()
        client.force_authenticate(user=outsider)
        self.assertEqual(client.get(url).status_code, 404)

    def test_verified_document_cannot_be_changed_by_a_second_review(self):
        owner, application = create_application(
            "single-review-owner", status=DriverApplication.Status.SUBMITTED
        )
        reviewer = create_user("single-review-admin", LogisticsUser.Role.TOP_USER_ADMIN)
        document = DriverDocument.objects.create(
            application=application,
            document_type="identity",
            file="driver-documents/test/verified.pdf",
            uploaded_by=owner,
        )
        client = APIClient()
        client.force_authenticate(user=reviewer)
        first = client.post(
            f"/api/admin/driver-documents/{document.pk}/verify/",
            {"verification_status": "verified", "reason": "Matched record."},
            format="json",
        )
        second = client.post(
            f"/api/admin/driver-documents/{document.pk}/verify/",
            {"verification_status": "rejected", "reason": "Attempt to overwrite."},
            format="json",
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 400)
        document.refresh_from_db()
        self.assertEqual(document.verification_status, DriverDocument.VerificationStatus.VERIFIED)


def create_buyer(username, role=LogisticsUser.Role.WHOLESALER):
    return create_user(
        username,
        role,
        external_user_id=f"market-{username}",
    )


def create_eligible_shipment_driver(username, region="North", weight="1200.00"):
    driver, application = create_application(
        username,
        status=DriverApplication.Status.APPROVED,
        service_region=region,
        cargo_capacity_kg=weight,
    )
    reviewer = create_user(f"{username}-reviewer", LogisticsUser.Role.SUPER_ADMIN)
    DriverDocument.objects.create(
        application=application,
        document_type="identity",
        file=SimpleUploadedFile("identity.pdf", b"%PDF-1.4 verified"),
        verification_status=DriverDocument.VerificationStatus.VERIFIED,
        verified_by=reviewer,
        uploaded_by=driver,
    )
    driver.driver_profile.is_available = True
    driver.driver_profile.save(update_fields=["is_available", "updated_at"])
    return driver, application


@override_settings(
    DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
    MARKETPLACE_INTEGRATION_ENABLED=False,
)
class DriverAvailabilityApiTests(PrivateStorageTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.driver, self.application = create_eligible_shipment_driver("availability-driver")
        self.driver.driver_profile.is_available = False
        self.driver.driver_profile.save(update_fields=["is_available", "updated_at"])
        self.client = APIClient()
        self.client.force_authenticate(user=self.driver)

    def test_approved_driver_can_toggle_and_state_persists(self):
        enabled = self.client.patch(
            "/api/drivers/me/availability/", {"available": True}, format="json"
        )
        self.assertEqual(enabled.status_code, 200, enabled.data)
        self.assertEqual(enabled.data, {"available": True, "eligible": True})
        self.driver.driver_profile.refresh_from_db()
        self.assertTrue(self.driver.driver_profile.is_available)

        self.client.logout()
        self.client.force_authenticate(user=self.driver)
        persisted = self.client.get("/api/drivers/me/availability/")
        self.assertEqual(persisted.status_code, 200)
        self.assertTrue(persisted.data["available"])

        disabled = self.client.patch(
            "/api/drivers/me/availability/", {"available": False}, format="json"
        )
        self.assertEqual(disabled.status_code, 200)
        self.assertFalse(disabled.data["available"])

    def test_unapproved_driver_cannot_enable_availability(self):
        self.application.status = DriverApplication.Status.SUBMITTED
        self.application.save(update_fields=["status"])
        response = self.client.patch(
            "/api/drivers/me/availability/", {"available": True}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.driver.driver_profile.refresh_from_db()
        self.assertFalse(self.driver.driver_profile.is_available)

    def test_inactive_driver_is_excluded_from_matching(self):
        self.driver.driver_profile.is_available = False
        self.driver.driver_profile.save(update_fields=["is_available", "updated_at"])
        self.assertEqual(list(eligible_driver_applications("North", Decimal("10"))), [])

    def test_existing_assigned_shipment_remains_visible_after_deactivation(self):
        self.driver.driver_profile.is_available = False
        self.driver.driver_profile.save(update_fields=["is_available", "updated_at"])
        shipment = Shipment.objects.create(
            buyer=create_buyer("availability-assigned-buyer"),
            seller=create_user("availability-assigned-seller", LogisticsUser.Role.FARMER),
            pickup_region="North",
            destination_region="North",
            product_summary="Assigned cargo",
            status=Shipment.Status.ASSIGNED,
            assigned_driver=self.driver,
        )
        response = self.client.get("/api/shipments/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(shipment.pk, {item["id"] for item in response.data})


def shipment_request_payload(reference="MARKET-ORDER-42"):
    return {
        "external_order_reference": reference,
        "pickup_region": "North",
        "pickup_zone": "Highland",
        "pickup_wereda": "Market Wereda",
        "pickup_address": "Private farm gate",
        "destination_region": "North",
        "destination_zone": "Highland",
        "destination_wereda": "Market Wereda",
        "destination_address": "Private receiving depot",
        "product_summary": "Two crates of tomatoes",
        "cargo_weight_kg": "100.00",
        "handling_requirements": "Keep upright",
        "initial_fee": "250.00",
        "currency": "ETB",
    }


@override_settings(
    DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
    MARKETPLACE_INTEGRATION_ENABLED=False,
)
class ShipmentWorkflowApiTests(PrivateStorageTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.buyer = create_buyer("shipment-buyer")
        self.seller = create_user(
            "shipment-seller",
            LogisticsUser.Role.FARMER,
            external_user_id="market-shipment-seller",
        )
        self.driver, self.application = create_eligible_shipment_driver(
            "shipment-driver"
        )
        self.client = APIClient()

    def authorize_order(self, reference="MARKET-ORDER-42", eligible=True):
        return authorize_marketplace_order(
            reference,
            self.buyer.external_user_id,
            eligible,
            seller_external_user_id=self.seller.external_user_id,
        )

    def create_request(self, reference="MARKET-ORDER-42"):
        self.authorize_order(reference)
        self.client.force_authenticate(user=self.buyer)
        return self.client.post(
            "/api/shipments/",
            shipment_request_payload(reference),
            format="json",
        )

    def assign_request(self, reference):
        response = self.create_request(reference)
        self.assertEqual(response.status_code, 201)
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        proposal = ShipmentFeeProposal.objects.get(
            shipment_id=shipment_id, proposed_by=self.buyer
        )
        self.client.force_authenticate(user=self.driver)
        accepted = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {"proposal_id": proposal.pk, "version": proposal.version},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200)
        return shipment_id

    def advance_to_transit(self, shipment_id):
        for target in (
            Shipment.Status.PICKUP_PENDING,
            Shipment.Status.PICKUP_ARRIVED,
        ):
            response = self.client.post(
                f"/api/shipments/{shipment_id}/status/",
                {"status": target},
                format="json",
            )
            self.assertEqual(response.status_code, 200)
        upload = self.client.post(
            f"/api/shipments/{shipment_id}/evidence/",
            {
                "evidence_type": ShipmentEvidence.Type.PICKUP,
                "file": SimpleUploadedFile(
                    "pickup.pdf", b"%PDF-1.4 private pickup", content_type="application/pdf"
                ),
            },
            format="multipart",
        )
        self.assertEqual(upload.status_code, 201, upload.data)
        for target in (Shipment.Status.PICKED_UP, Shipment.Status.IN_TRANSIT):
            response = self.client.post(
                f"/api/shipments/{shipment_id}/status/",
                {"status": target},
                format="json",
            )
            self.assertEqual(response.status_code, 200)

    def test_unverified_order_request_is_held_without_driver_offer(self):
        self.client.force_authenticate(user=self.buyer)
        response = self.client.post(
            "/api/shipments/", shipment_request_payload(), format="json"
        )

        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.data["order_verified"])
        self.assertEqual(response.data["status"], Shipment.Status.REQUESTED)
        pending_shipment = Shipment.objects.get(pk=response.data["id"])
        self.assertIsNone(pending_shipment.seller_id)
        self.assertEqual(pending_shipment.currency, "ETB")
        self.assertEqual(
            pending_shipment.fee_agreement_status,
            Shipment.FeeAgreementStatus.PENDING,
        )
        self.assertEqual(
            ShipmentOffer.objects.filter(shipment_id=response.data["id"]).count(), 0
        )

        self.client.force_authenticate(user=self.driver)
        offers = self.client.get("/api/drivers/me/shipment-offers/")
        self.assertEqual(offers.status_code, 200)
        self.assertEqual(offers.data, [])

        self.authorize_order()
        shipment = Shipment.objects.get(pk=response.data["id"])
        self.assertTrue(shipment.order_verified)
        self.assertEqual(shipment.seller_id, self.seller.pk)
        self.assertEqual(shipment.status, Shipment.Status.FEE_PROPOSED)
        self.assertEqual(shipment.offers.filter(driver=self.driver).count(), 1)
        self.assertEqual(response.data["currency"], "ETB")
        self.assertEqual(response.data["fee_agreement_status"], "pending")

    def test_model_rejects_invalid_currency_and_same_buyer_seller(self):
        shipment = Shipment(
            external_order_reference="MODEL-ORDER",
            buyer=self.buyer,
            seller=self.buyer,
            pickup_region="North",
            pickup_address="Private address",
            destination_region="South",
            destination_address="Private destination",
            product_summary="One crate",
            currency="invalid",
        )

        with self.assertRaises(DjangoValidationError):
            shipment.full_clean()

        shipment.seller = self.seller
        shipment.currency = "ETB"
        shipment.full_clean()
        self.assertEqual(shipment.fee_agreement_status, Shipment.FeeAgreementStatus.PENDING)

    def test_eligible_order_requires_authorized_seller_mapping(self):
        with self.assertRaises(ValidationError):
            authorize_marketplace_order(
                "ORDER-WITHOUT-SELLER",
                self.buyer.external_user_id,
                True,
            )

    def test_fee_requests_reject_nonpositive_amounts_and_unsupported_currency(self):
        self.client.force_authenticate(user=self.buyer)
        for fee, currency in (("0.00", "ETB"), ("-1.00", "ETB"), ("10.00", "USD")):
            payload = shipment_request_payload(f"INVALID-FEE-{fee}-{currency}")
            payload["initial_fee"] = fee
            payload["currency"] = currency
            response = self.client.post("/api/shipments/", payload, format="json")
            self.assertEqual(response.status_code, 400, (fee, currency))

    def test_order_authorization_is_bound_to_active_mapped_buyer(self):
        self.authorize_order()
        self.client.force_authenticate(user=self.buyer)
        request = self.client.post(
            "/api/shipments/", shipment_request_payload(), format="json"
        )
        self.assertEqual(request.status_code, 201)

        other_buyer = create_buyer("other-shipment-buyer", LogisticsUser.Role.RETAILER)
        self.client.force_authenticate(user=other_buyer)
        duplicate_reference = self.client.post(
            "/api/shipments/", shipment_request_payload(), format="json"
        )
        self.assertEqual(duplicate_reference.status_code, 404)

        with self.assertRaises(NotFound):
            authorize_marketplace_order(
                "ANOTHER-ORDER", "unmapped-marketplace-user", True
            )
        self.assertTrue(
            MarketplaceOrderAuthorization.objects.filter(
                external_order_reference="MARKET-ORDER-42",
                buyer=self.buyer,
            ).exists()
        )

    def test_only_buyer_roles_can_request_and_unrelated_users_cannot_read(self):
        for role in (
            LogisticsUser.Role.DRIVER,
            LogisticsUser.Role.FARMER,
            LogisticsUser.Role.FINANCIAL_MANAGER,
            LogisticsUser.Role.REGIONAL_ADMIN,
        ):
            user = create_user(f"shipment-denied-{role}", role)
            self.client.force_authenticate(user=user)
            response = self.client.post(
                "/api/shipments/", shipment_request_payload(), format="json"
            )
            self.assertEqual(response.status_code, 403, role)

        created = self.create_request()
        self.assertEqual(created.status_code, 201)
        outsider = create_buyer("shipment-outsider", LogisticsUser.Role.RETAILER)
        self.client.force_authenticate(user=outsider)
        self.assertEqual(
            self.client.get(f"/api/shipments/{created.data['id']}/").status_code,
            404,
        )

    def test_matching_filters_unapproved_expired_and_out_of_area_drivers(self):
        create_application(
            "unapproved-match",
            status=DriverApplication.Status.SUBMITTED,
            service_region="North",
        )
        expired_driver, expired_app = create_eligible_shipment_driver(
            "expired-document-match", region="North"
        )
        expired_document = expired_app.documents.get(document_type="identity")
        expired_document.expires_at = timezone.localdate() - timedelta(days=1)
        expired_document.save(update_fields=["expires_at"])
        create_eligible_shipment_driver("wrong-region-match", region="South")
        undersized_driver, undersized_app = create_eligible_shipment_driver(
            "undersized-match", region="North", weight="50.00"
        )

        response = self.create_request()
        self.assertEqual(response.status_code, 201)
        offer_drivers = set(
            ShipmentOffer.objects.filter(shipment_id=response.data["id"]).values_list(
                "driver_id", flat=True
            )
        )
        self.assertEqual(offer_drivers, {self.driver.pk})
        self.assertNotIn(expired_driver.pk, offer_drivers)
        self.assertNotIn(undersized_driver.pk, offer_drivers)
        self.assertNotEqual(expired_app.pk, undersized_app.pk)

    def test_offer_hides_addresses_and_order_reference_until_assignment(self):
        response = self.create_request()
        self.assertEqual(response.status_code, 201)
        shipment_id = response.data["id"]

        self.client.force_authenticate(user=self.driver)
        offers = self.client.get("/api/drivers/me/shipment-offers/")
        self.assertEqual(offers.status_code, 200)
        self.assertEqual(len(offers.data), 1)
        offer = offers.data[0]
        self.assertNotIn("pickup_address", offer)
        self.assertNotIn("destination_address", offer)
        self.assertIsNone(offer["external_order_reference"])
        self.assertEqual(
            self.client.get(f"/api/shipments/{shipment_id}/").status_code, 404
        )


@override_settings(
    DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
    MARKETPLACE_INTEGRATION_ENABLED=False,
)
class ShipmentLocationTrackingApiTests(PrivateStorageTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.buyer = create_buyer("location-buyer")
        self.seller = create_user(
            "location-seller",
            LogisticsUser.Role.FARMER,
            external_user_id="market-location-seller",
        )
        self.driver, self.application = create_eligible_shipment_driver(
            "location-driver"
        )
        self.reviewer = create_user(
            "location-reviewer", LogisticsUser.Role.SUPER_ADMIN
        )
        self.client = APIClient()

    def create_assigned_shipment(self):
        authorize_marketplace_order(
            "LOCATION-ORDER-1",
            self.buyer.external_user_id,
            True,
            seller_external_user_id=self.seller.external_user_id,
        )
        self.client.force_authenticate(user=self.buyer)
        created = self.client.post(
            "/api/shipments/", shipment_request_payload("LOCATION-ORDER-1"), format="json"
        )
        self.assertEqual(created.status_code, 201, created.data)
        shipment_id = created.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        proposal = ShipmentFeeProposal.objects.get(
            shipment_id=shipment_id, proposed_by=self.buyer
        )
        self.client.force_authenticate(user=self.driver)
        accepted = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {"proposal_id": proposal.pk, "version": proposal.version},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.data)
        return shipment_id

    def update_payload(self, **overrides):
        payload = {
            "latitude": "9.030000",
            "longitude": "38.740000",
            "accuracy_meters": "12.50",
            "observed_at": timezone.now().isoformat(),
        }
        payload.update(overrides)
        return payload

    def test_assigned_eligible_driver_can_share_and_buyer_can_read_latest_location(self):
        shipment_id = self.create_assigned_shipment()
        url = f"/api/shipments/{shipment_id}/tracking/"
        self.client.force_authenticate(user=self.driver)
        started = self.client.post(f"{url}start/", {}, format="json")
        self.assertEqual(started.status_code, 200, started.data)
        self.assertEqual(started.data["sharing_status"], "starting")

        update = self.client.post(
            f"{url}location/", self.update_payload(), format="json"
        )
        self.assertEqual(update.status_code, 200, update.data)
        self.assertEqual(update.data["sharing_status"], "sharing")
        self.assertEqual(update.data["location"]["latitude"], "9.030000")
        self.assertEqual(update.data["location"]["longitude"], "38.740000")
        self.assertTrue(
            AuditEvent.objects.filter(
                action="shipment.location_sharing_started",
                object_id=str(shipment_id),
            ).exists()
        )

        self.client.force_authenticate(user=self.buyer)
        viewed = self.client.get(url)
        self.assertEqual(viewed.status_code, 200, viewed.data)
        self.assertEqual(viewed.data["location"]["accuracy_meters"], "12.50")
        self.assertEqual(viewed.data["shipment_status"], Shipment.Status.ASSIGNED)

    def test_unauthenticated_and_unrelated_users_cannot_start_update_or_read_location(self):
        shipment_id = self.create_assigned_shipment()
        url = f"/api/shipments/{shipment_id}/tracking/"
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(url).status_code, 401)

        outsider = create_buyer("location-outsider", LogisticsUser.Role.RETAILER)
        self.client.force_authenticate(user=outsider)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.post(f"{url}start/").status_code, 404)
        self.assertEqual(
            self.client.post(
                f"{url}location/", self.update_payload(), format="json"
            ).status_code,
            404,
        )

        self.client.force_authenticate(user=self.buyer)
        self.assertEqual(
            self.client.post(f"{url}location/", self.update_payload(), format="json").status_code,
            404,
        )

    def test_location_updates_reject_bad_coordinates_accuracy_and_stale_timestamps(self):
        shipment_id = self.create_assigned_shipment()
        url = f"/api/shipments/{shipment_id}/tracking/"
        self.client.post(f"{url}start/", {}, format="json")
        out_of_range = self.client.post(
            f"{url}location/",
            self.update_payload(latitude="91"),
            format="json",
        )
        self.assertEqual(out_of_range.status_code, 400)
        poor_accuracy = self.client.post(
            f"{url}location/",
            self.update_payload(accuracy_meters="1001.00"),
            format="json",
        )
        self.assertEqual(poor_accuracy.status_code, 400)
        stale = self.client.post(
            f"{url}location/",
            self.update_payload(
                observed_at=(timezone.now() - timedelta(minutes=3)).isoformat()
            ),
            format="json",
        )
        self.assertEqual(stale.status_code, 400)
        missing_offset = self.client.post(
            f"{url}location/",
            self.update_payload(observed_at=timezone.now().strftime("%Y-%m-%dT%H:%M:%S")),
            format="json",
        )
        self.assertEqual(missing_offset.status_code, 400)
        self.assertIsNone(
            DriverShipmentLocation.objects.get(shipment_id=shipment_id).latitude
        )

    def test_updates_require_live_sharing_and_sharing_expires_server_side(self):
        shipment_id = self.create_assigned_shipment()
        url = f"/api/shipments/{shipment_id}/tracking/"
        self.assertEqual(
            self.client.post(
                f"{url}location/", self.update_payload(), format="json"
            ).status_code,
            409,
        )
        started = self.client.post(f"{url}start/", {}, format="json")
        self.assertEqual(started.status_code, 200)
        location = DriverShipmentLocation.objects.get(shipment_id=shipment_id)
        location.sharing_expires_at = timezone.now() - timedelta(seconds=1)
        location.save(update_fields=["sharing_expires_at"])
        expired = self.client.post(
            f"{url}location/", self.update_payload(), format="json"
        )
        self.assertEqual(expired.status_code, 409)

    @override_settings(DRIVER_LOCATION_MAX_PAYLOAD_BYTES=64)
    def test_oversized_location_payload_is_rejected(self):
        shipment_id = self.create_assigned_shipment()
        url = f"/api/shipments/{shipment_id}/tracking/"
        self.client.post(f"{url}start/", {}, format="json")

        oversized = self.client.post(
            f"{url}location/",
            {"extra": "x" * 256},
            format="json",
        )

        self.assertEqual(oversized.status_code, 413)

    def test_stop_is_audited_and_terminal_dispute_removes_the_precise_location(self):
        shipment_id = self.create_assigned_shipment()
        url = f"/api/shipments/{shipment_id}/tracking/"
        self.client.post(f"{url}start/", {}, format="json")
        self.client.post(
            f"{url}location/", self.update_payload(), format="json"
        )
        stopped = self.client.post(f"{url}stop/", {}, format="json")
        self.assertEqual(stopped.status_code, 200)
        self.assertFalse(stopped.data["is_sharing"])
        self.assertEqual(stopped.data["sharing_status"], "stopped")
        self.assertTrue(
            AuditEvent.objects.filter(
                action="shipment.location_sharing_stopped",
                object_id=str(shipment_id),
            ).exists()
        )

        self.client.post(f"{url}start/", {}, format="json")
        self.client.post(
            f"{url}location/", self.update_payload(), format="json"
        )
        disputed = self.client.post(
            f"/api/shipments/{shipment_id}/dispute/",
            {"reason": "Tracking should end when the shipment is disputed."},
            format="json",
        )
        self.assertEqual(disputed.status_code, 200, disputed.data)
        location = DriverShipmentLocation.objects.get(shipment_id=shipment_id)
        self.assertIsNone(location.latitude)
        self.assertIsNone(location.longitude)
        self.assertIsNotNone(location.sharing_stopped_at)
        self.client.force_authenticate(user=self.buyer)
        self.assertIsNone(self.client.get(url).data["location"])

    def test_driver_suspension_invalidates_active_location_and_clears_coordinates(self):
        shipment_id = self.create_assigned_shipment()
        tracking_url = f"/api/shipments/{shipment_id}/tracking/"
        self.client.post(f"{tracking_url}start/", {}, format="json")
        self.client.post(
            f"{tracking_url}location/", self.update_payload(), format="json"
        )

        self.client.force_authenticate(user=self.reviewer)
        suspended = self.client.post(
            f"/api/admin/driver-applications/{self.application.pk}/review/",
            {"status": DriverApplication.Status.SUSPENDED, "reason": "Credential review"},
            format="json",
        )

        self.assertEqual(suspended.status_code, 200, suspended.data)
        self.driver.refresh_from_db()
        self.assertFalse(self.driver.is_active)
        location = DriverShipmentLocation.objects.get(shipment_id=shipment_id)
        self.assertIsNone(location.latitude)
        self.assertIsNone(location.longitude)
        self.assertIsNotNone(location.sharing_stopped_at)
        self.assertTrue(
            AuditEvent.objects.filter(
                action="shipment.location_sharing_invalidated",
                object_id=str(shipment_id),
            ).exists()
        )


@override_settings(
    MARKETPLACE_INTEGRATION_ENABLED=True,
    MARKETPLACE_INTEGRATION_SECRET="integration-test-secret-" * 3,
    MARKETPLACE_INTEGRATION_MAX_BYTES=4096,
    MARKETPLACE_INTEGRATION_MAX_SKEW_SECONDS=300,
    DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
)
class MarketplaceIntegrationApiTests(PrivateStorageTestMixin, TestCase):
    integration_secret = "integration-test-secret-" * 3
    order_event_path = "/api/integrations/v1/orders/events/"
    v2_event_path = "/api/integrations/v2/events/"

    def setUp(self):
        super().setUp()
        self.buyer = create_buyer("integration-buyer")
        self.seller = create_user(
            "integration-seller",
            LogisticsUser.Role.FARMER,
            external_user_id="market-integration-seller",
        )
        self.client = APIClient()

    def authorized_event(self, event_id="integration-order-authorized", revision=1):
        shipment = shipment_request_payload()
        shipment.pop("external_order_reference")
        shipment.pop("initial_fee")
        shipment.pop("currency")
        return {
            "contract_version": "1",
            "event_id": event_id,
            "event_type": "order.authorized",
            "occurred_at": timezone.now().isoformat(),
            "revision": revision,
            "order": {
                "id": "MAIN-MARKET-ORDER-1",
                "status": "authorized",
                "buyer": {
                    "external_user_id": self.buyer.external_user_id,
                    "role": self.buyer.role,
                },
                "seller": {
                    "external_user_id": self.seller.external_user_id,
                    "role": self.seller.role,
                },
                "shipment": shipment,
                "delivery_fee": {"amount": "250.00", "currency": "ETB"},
            },
        }

    def v2_authorized_event(self, order_reference=None, event_id=None, revision=1):
        return {
            "contract_version": "2",
            "source_system": "greenpath_marketplace",
            "event_id": str(event_id or uuid.uuid4()),
            "event_type": "order.authorized",
            "occurred_at": timezone.now().isoformat(),
            "revision": revision,
            "order_reference": str(order_reference or uuid.uuid4()),
            "buyer": {
                "external_user_id": self.buyer.external_user_id,
                "role": self.buyer.role,
            },
            "seller": {
                "external_user_id": self.seller.external_user_id,
                "role": self.seller.role,
            },
            "shipment": {
                "pickup": {
                    "region": "North",
                    "zone": "Highland",
                    "wereda": "Market Wereda",
                    "kebele": None,
                    "address_line": "Confirmed farm gate",
                },
                "destination": {
                    "region": "North",
                    "zone": None,
                    "wereda": None,
                    "kebele": None,
                    "address_line": "Confirmed warehouse entrance",
                },
                "product": {
                    "id": str(uuid.uuid4()),
                    "description": "Fresh tomatoes",
                    "quantity": "20.00",
                    "unit": "crate",
                },
                "cargo_weight_kg": "250.00",
                "packaging_details": "Sealed ventilated crates",
                "details_revision": 1,
            },
            "delivery_fee_proposal": {
                "amount": "300.00",
                "currency": "ETB",
                "proposer": "buyer",
                "version": 1,
            },
        }

    def v2_driver_authorization_event(
        self, canonical_user_id=None, event_id=None, revision=1, authorized=True
    ):
        canonical_user_id = canonical_user_id or uuid.uuid4()
        return {
            "contract_version": "2",
            "source_system": "greenpath_marketplace",
            "event_id": str(event_id or uuid.uuid4()),
            "event_type": "driver.authorization_snapshot",
            "occurred_at": timezone.now().isoformat(),
            "revision": revision,
            "canonical_user_id": str(canonical_user_id),
            "driver_authorization": {
                "account_status": "APPROVED" if authorized else "PENDING_APPROVAL",
                "account_active": authorized,
                "application_status": "approved" if authorized else "draft",
                "driver_authorized": authorized,
                "documents_verified": authorized,
                "license_expiry": (
                    (timezone.localdate() + timedelta(days=365)).isoformat()
                    if authorized
                    else None
                ),
                "legal_full_name": "Canonical Marketplace Driver",
                "phone": "+251900000009",
                "service_region": "North" if authorized else "",
                "service_zone": "Highland" if authorized else "",
                "service_wereda": "Market Wereda" if authorized else "",
                "service_kebele": "" ,
                "license_number": "LIC-CANONICAL" if authorized else "",
                "vehicle_type": "Small truck" if authorized else "",
                "vehicle_registration": "REG-CANONICAL" if authorized else "",
                "cargo_capacity_kg": "1200.00" if authorized else None,
            },
        }

    def test_v2_driver_authorization_creates_passwordless_idempotent_link(self):
        event = self.v2_driver_authorization_event()

        first = self.signed_request("POST", self.v2_event_path, event)
        replay = self.signed_request("POST", self.v2_event_path, event)

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data["status"], "applied")
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(replay.data, first.data)
        user = LogisticsUser.objects.get(
            external_user_id=event["canonical_user_id"]
        )
        self.assertEqual(user.role, LogisticsUser.Role.DRIVER)
        self.assertTrue(user.is_active)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(MarketplaceIntegrationEvent.objects.filter(
            event_id=event["event_id"]
        ).count(), 1)
        identity = MarketplaceDriverIdentity.objects.get(user=user)
        self.assertTrue(identity.driver_authorized)
        self.assertEqual(identity.revision, 1)

    def test_v2_pending_driver_snapshot_stays_inactive_without_complete_profile(self):
        event = self.v2_driver_authorization_event(authorized=False)

        response = self.signed_request("POST", self.v2_event_path, event)

        self.assertEqual(response.status_code, 200, response.data)
        user = LogisticsUser.objects.get(
            external_user_id=event["canonical_user_id"]
        )
        self.assertFalse(user.is_active)
        self.assertFalse(user.has_usable_password())
        self.assertFalse(
            MarketplaceDriverIdentity.objects.get(user=user).driver_authorized
        )
        self.assertIsNone(user.driver_profile.application.cargo_capacity_kg)

    def test_v2_driver_authorization_rejects_stale_revision(self):
        canonical_user_id = uuid.uuid4()
        current = self.v2_driver_authorization_event(
            canonical_user_id=canonical_user_id, revision=2
        )
        stale = self.v2_driver_authorization_event(
            canonical_user_id=canonical_user_id, revision=1, authorized=False
        )

        current_response = self.signed_request("POST", self.v2_event_path, current)
        stale_response = self.signed_request("POST", self.v2_event_path, stale)

        self.assertEqual(current_response.status_code, 200, current_response.data)
        self.assertEqual(stale_response.status_code, 409, stale_response.data)
        self.assertEqual(stale_response.data["code"], "stale_revision")
        identity = MarketplaceDriverIdentity.objects.get(
            marketplace_user_id=canonical_user_id
        )
        self.assertTrue(identity.driver_authorized)
        self.assertEqual(identity.revision, 2)

    def test_marketplace_approval_is_required_for_driver_offers(self):
        driver, application = create_application(
            "canonical-offer-driver",
            status=DriverApplication.Status.APPROVED,
            service_region="North",
        )
        self.assertEqual(
            list(eligible_driver_applications("North", Decimal("10"))), []
        )
        MarketplaceDriverIdentity.objects.create(
            marketplace_user_id=uuid.uuid4(),
            user=driver,
            profile=driver.driver_profile,
            revision=1,
            account_status="APPROVED",
            account_active=True,
            application_status="approved",
            documents_verified=True,
            driver_authorized=True,
            license_expiry=application.license_expiry,
            last_event_id=uuid.uuid4(),
            payload_sha256="a" * 64,
        )
        driver.driver_profile.is_available = True
        driver.driver_profile.save(update_fields=["is_available", "updated_at"])
        self.assertEqual(
            list(eligible_driver_applications("North", Decimal("10"))),
            [application],
        )
        MarketplaceDriverIdentity.objects.filter(user=driver).update(
            driver_authorized=False
        )
        self.assertEqual(
            list(eligible_driver_applications("North", Decimal("10"))), []
        )

    def test_marketplace_session_exchange_requires_current_driver_authorization(self):
        event = self.v2_driver_authorization_event()
        applied = self.signed_request("POST", self.v2_event_path, event)
        self.assertEqual(applied.status_code, 200, applied.data)
        user = LogisticsUser.objects.get(
            external_user_id=event["canonical_user_id"]
        )
        upstream = Mock()
        upstream.__enter__ = Mock(return_value=upstream)
        upstream.__exit__ = Mock(return_value=False)
        upstream.read.return_value = json.dumps(
            {
                "user": {
                    "id": event["canonical_user_id"],
                    "role": "DRIVER",
                    "status": "APPROVED",
                }
            }
        ).encode("utf-8")
        with self.settings(
            GREENPATH_MARKETPLACE_API_BASE_URL="http://localhost:8000",
            MARKETPLACE_LOGIN_ALLOWED_ORIGINS=["http://localhost:3000"],
        ), patch("logistics.marketplace_session_views.urlopen", return_value=upstream):
            response = self.client.post(
                "/api/integrations/v2/driver/session/",
                {"marketplace_access_token": "test-only-bearer"},
                format="json",
                HTTP_ORIGIN="http://localhost:3000",
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["authenticated"])
        self.assertEqual(str(self.client.session["_auth_user_id"]), str(user.pk))
        self.assertNotIn("test-only-bearer", response.content.decode("utf-8"))

    def test_independent_driver_registration_is_disabled_in_marketplace_mode(self):
        cache.clear()
        response = self.client.post(
            "/api/auth/register/",
            {
                "username": "independent-driver",
                "email": "independent-driver@example.test",
                "password": "A-Strong-Test-Password-123!",
                "legal_full_name": "Independent Driver",
                "phone_number": "+251900000010",
                "preferred_language": "en",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 410, response.data)
        self.assertFalse(
            LogisticsUser.objects.filter(username="independent-driver").exists()
        )

    def test_marketplace_session_exchange_denies_revoked_snapshot(self):
        event = self.v2_driver_authorization_event()
        applied = self.signed_request("POST", self.v2_event_path, event)
        self.assertEqual(applied.status_code, 200, applied.data)
        MarketplaceDriverIdentity.objects.filter(
            marketplace_user_id=event["canonical_user_id"]
        ).update(driver_authorized=False)
        upstream = Mock()
        upstream.__enter__ = Mock(return_value=upstream)
        upstream.__exit__ = Mock(return_value=False)
        upstream.read.return_value = json.dumps(
            {
                "user": {
                    "id": event["canonical_user_id"],
                    "role": "DRIVER",
                    "status": "APPROVED",
                }
            }
        ).encode("utf-8")
        with self.settings(
            GREENPATH_MARKETPLACE_API_BASE_URL="http://localhost:8000",
            MARKETPLACE_LOGIN_ALLOWED_ORIGINS=["http://localhost:3000"],
        ), patch("logistics.marketplace_session_views.urlopen", return_value=upstream):
            response = self.client.post(
                "/api/integrations/v2/driver/session/",
                {"marketplace_access_token": "test-only-bearer"},
                format="json",
                HTTP_ORIGIN="http://localhost:3000",
            )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertNotIn("_auth_user_id", self.client.session)

    def signed_request(
        self,
        method,
        path,
        payload=None,
        request_id=None,
        timestamp=None,
        corrupt_signature=False,
    ):
        body = (
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if payload is not None
            else b""
        )
        request_id = request_id or (
            payload["event_id"] if payload is not None else "integration-poll-request"
        )
        timestamp = timestamp or str(int(time.time()))
        canonical = b"\n".join(
            (
                timestamp.encode("ascii"),
                request_id.encode("utf-8"),
                method.upper().encode("ascii"),
                path.encode("utf-8"),
                body,
            )
        )
        signature = hmac.new(
            self.integration_secret.encode("utf-8"),
            canonical,
            hashlib.sha256,
        ).hexdigest()
        if corrupt_signature:
            signature = ("0" if signature[0] != "0" else "1") + signature[1:]
        return self.client.generic(
            method,
            path,
            data=body,
            content_type="application/json",
            HTTP_X_GP_INTEGRATION_TIMESTAMP=timestamp,
            HTTP_X_GP_INTEGRATION_REQUEST_ID=request_id,
            HTTP_X_GP_INTEGRATION_SIGNATURE=f"sha256={signature}",
        )

    def test_integration_requests_require_hmac_authentication(self):
        response = self.client.post(
            self.order_event_path,
            data=json.dumps(self.authorized_event()),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertFalse(Shipment.objects.exists())
        self.assertTrue(
            AuditEvent.objects.filter(
                action="marketplace.integration_auth_rejected",
                details__reason="malformed_auth_headers",
            ).exists()
        )

    def test_v2_authorization_stores_structured_cargo_without_breaking_v1(self):
        event = self.v2_authorized_event()

        response = self.signed_request("POST", self.v2_event_path, event)

        self.assertEqual(response.status_code, 200, response.data)
        shipment = Shipment.objects.get(
            external_order_reference=event["order_reference"]
        )
        self.assertEqual(shipment.pickup_kebele, "")
        self.assertEqual(shipment.destination_address, "Confirmed warehouse entrance")
        self.assertEqual(shipment.external_product_reference, event["shipment"]["product"]["id"])
        self.assertEqual(shipment.cargo_quantity, Decimal("20.00"))
        self.assertEqual(shipment.cargo_quantity_unit, "crate")
        self.assertEqual(shipment.packaging_details, "Sealed ventilated crates")
        self.assertEqual(shipment.payment_status, Shipment.PaymentStatus.UNAVAILABLE)

    def test_v2_payment_snapshot_is_exact_informational_and_idempotent(self):
        authorization = self.v2_authorized_event(revision=1)
        authorized_response = self.signed_request(
            "POST", self.v2_event_path, authorization
        )
        self.assertEqual(authorized_response.status_code, 200, authorized_response.data)

        payment_event = {
            "contract_version": "2",
            "source_system": "greenpath_marketplace",
            "event_id": str(uuid.uuid4()),
            "event_type": "payment.status_snapshot",
            "occurred_at": timezone.now().isoformat(),
            "revision": 2,
            "order_reference": authorization["order_reference"],
            "payment": {"status": "RELEASE_PENDING"},
        }
        first = self.signed_request("POST", self.v2_event_path, payment_event)
        replay = self.signed_request("POST", self.v2_event_path, payment_event)

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(first.data, replay.data)
        shipment = Shipment.objects.get(
            external_order_reference=authorization["order_reference"]
        )
        self.assertEqual(shipment.payment_status, Shipment.PaymentStatus.UNAVAILABLE)
        snapshot = MarketplacePaymentSnapshot.objects.get()
        self.assertEqual(snapshot.status, "RELEASE_PENDING")
        self.assertEqual(snapshot.revision, 2)

    def test_v2_payment_snapshot_rejects_legacy_v1_status_and_stale_revision(self):
        authorization = self.v2_authorized_event(revision=2)
        self.assertEqual(
            self.signed_request("POST", self.v2_event_path, authorization).status_code,
            200,
        )
        payment_event = {
            "contract_version": "2",
            "source_system": "greenpath_marketplace",
            "event_id": str(uuid.uuid4()),
            "event_type": "payment.status_snapshot",
            "occurred_at": timezone.now().isoformat(),
            "revision": 1,
            "order_reference": authorization["order_reference"],
            "payment": {"status": "paid"},
        }
        invalid = self.signed_request("POST", self.v2_event_path, payment_event)
        self.assertEqual(invalid.status_code, 400)
        payment_event["payment"]["status"] = "HELD"
        stale = self.signed_request("POST", self.v2_event_path, payment_event)
        self.assertEqual(stale.status_code, 409)
        shipment = Shipment.objects.get(
            external_order_reference=authorization["order_reference"]
        )
        self.assertEqual(shipment.payment_status, Shipment.PaymentStatus.UNAVAILABLE)
        self.assertFalse(MarketplacePaymentSnapshot.objects.exists())

    def _v2_fee_review_event(self, *, amount="300.00", revision=2, decision="approved"):
        authorization = self.v2_authorized_event()
        response = self.signed_request("POST", self.v2_event_path, authorization)
        self.assertEqual(response.status_code, 200, response.data)
        shipment = Shipment.objects.get(
            external_order_reference=authorization["order_reference"]
        )
        proposal = ShipmentFeeProposal.objects.get(shipment=shipment)
        now = timezone.now()
        ShipmentFeeAgreement.objects.create(
            shipment=shipment,
            proposal=proposal,
            buyer=shipment.buyer,
            driver=self.seller,
            amount=proposal.amount,
            currency=proposal.currency,
            buyer_accepted_at=now,
            driver_accepted_at=now,
        )
        agreement_event_id = uuid.uuid4()
        MarketplaceShipmentEvent.objects.create(
            event_id=agreement_event_id,
            shipment=shipment,
            event_type="delivery_fee.agreed",
            details={
                "amount": str(proposal.amount),
                "currency": proposal.currency,
                "proposal_version": proposal.version,
            },
        )
        event = {
            "contract_version": "2",
            "source_system": "greenpath_marketplace",
            "event_id": str(uuid.uuid4()),
            "event_type": "delivery_fee.reviewed",
            "occurred_at": timezone.now().isoformat(),
            "revision": revision,
            "order_reference": authorization["order_reference"],
            "delivery_fee_review": {
                "agreement_event_id": str(agreement_event_id),
                "shipment_id": shipment.pk,
                "proposal_version": proposal.version,
                "amount": amount,
                "currency": proposal.currency,
                "decision": decision,
                "message": "The marketplace delivery-fee review is complete.",
            },
        }
        if decision == "rejected":
            event["delivery_fee_review"]["rejection_reason"] = "Fee requires correction."
        return event, shipment

    def test_v2_delivery_fee_review_matches_agreement_and_is_idempotent(self):
        event, shipment = self._v2_fee_review_event()

        first = self.signed_request("POST", self.v2_event_path, event)
        replay = self.signed_request("POST", self.v2_event_path, event)

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(first.data, replay.data)
        review = MarketplaceDeliveryFeeReview.objects.get()
        self.assertEqual(review.agreement_event_id, uuid.UUID(event["delivery_fee_review"]["agreement_event_id"]))
        self.assertEqual(review.proposal_version, 1)
        self.assertEqual(review.decision, "approved")
        self.assertEqual(shipment.fee_agreement_status, Shipment.FeeAgreementStatus.PENDING)
        self.assertEqual(shipment.payment_status, Shipment.PaymentStatus.UNAVAILABLE)

        duplicate_event = dict(event)
        duplicate_event["event_id"] = str(uuid.uuid4())
        duplicate_event["revision"] = 3
        duplicate = self.signed_request("POST", self.v2_event_path, duplicate_event)
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.data["code"], "agreement_review_already_recorded")
        self.assertEqual(MarketplaceDeliveryFeeReview.objects.count(), 1)

    def test_v2_delivery_fee_review_rejects_amount_mismatched_to_agreement(self):
        event, _ = self._v2_fee_review_event(amount="301.00")

        response = self.signed_request("POST", self.v2_event_path, event)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "agreement_mismatch")
        self.assertFalse(MarketplaceDeliveryFeeReview.objects.exists())

    def test_v2_delivery_fee_review_rejects_stale_revision(self):
        event, _ = self._v2_fee_review_event(revision=1)

        response = self.signed_request("POST", self.v2_event_path, event)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "stale_revision")
        self.assertFalse(MarketplaceDeliveryFeeReview.objects.exists())

    def test_authorized_order_creates_trusted_shipment_and_is_idempotent(self):
        event = self.authorized_event()
        first = self.signed_request("POST", self.order_event_path, event)
        event_count = MarketplaceShipmentEvent.objects.count()
        replay = self.signed_request("POST", self.order_event_path, event)

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(first.data, replay.data)
        shipment = Shipment.objects.get(external_order_reference=event["order"]["id"])
        self.assertEqual(shipment.buyer_id, self.buyer.pk)
        self.assertEqual(shipment.seller_id, self.seller.pk)
        self.assertTrue(shipment.order_verified)
        self.assertEqual(shipment.status, Shipment.Status.FEE_PROPOSED)
        self.assertEqual(shipment.payment_status, Shipment.PaymentStatus.UNAVAILABLE)
        self.assertEqual(
            shipment.fee_agreement_status, Shipment.FeeAgreementStatus.PENDING
        )
        self.assertEqual(shipment.current_fee_proposal_version, 1)
        self.assertEqual(ShipmentFeeProposal.objects.filter(shipment=shipment).count(), 1)
        self.assertEqual(MarketplaceIntegrationEvent.objects.count(), 1)
        self.assertEqual(MarketplaceShipmentEvent.objects.count(), event_count)
        self.assertTrue(
            AuditEvent.objects.filter(action="marketplace.order_authorized").exists()
        )

    def test_event_id_cannot_be_reused_with_changed_payload(self):
        event = self.authorized_event()
        self.assertEqual(
            self.signed_request("POST", self.order_event_path, event).status_code, 200
        )
        event["order"]["delivery_fee"]["amount"] = "300.00"

        response = self.signed_request("POST", self.order_event_path, event)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(Shipment.objects.count(), 1)
        self.assertEqual(
            ShipmentFeeProposal.objects.get().amount,
            Decimal("250.00"),
        )
        self.assertTrue(
            AuditEvent.objects.filter(
                action="marketplace.integration_event_id_conflict",
                object_id=event["event_id"],
            ).exists()
        )

    def test_participant_identity_and_role_must_match_mapped_accounts(self):
        event = self.authorized_event()
        event["order"]["buyer"]["role"] = LogisticsUser.Role.RETAILER

        response = self.signed_request("POST", self.order_event_path, event)

        self.assertEqual(response.status_code, 403)
        self.assertFalse(Shipment.objects.exists())
        self.assertTrue(
            AuditEvent.objects.filter(
                action="marketplace.integration_event_rejected",
                details__reason="participant_mismatch",
            ).exists()
        )

    def test_newer_event_cannot_replace_order_participants(self):
        first = self.authorized_event()
        self.assertEqual(
            self.signed_request("POST", self.order_event_path, first).status_code, 200
        )
        different_seller = create_user(
            "integration-other-seller",
            LogisticsUser.Role.FARMER,
            external_user_id="market-integration-other-seller",
        )
        changed = self.authorized_event("integration-order-seller-conflict", revision=2)
        changed["order"]["seller"]["external_user_id"] = different_seller.external_user_id

        response = self.signed_request("POST", self.order_event_path, changed)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(Shipment.objects.count(), 1)
        self.assertEqual(
            MarketplaceOrderAuthorization.objects.get().seller_id, self.seller.pk
        )

    def test_stale_or_out_of_order_revisions_are_rejected(self):
        event = self.authorized_event(revision=2)
        self.assertEqual(
            self.signed_request("POST", self.order_event_path, event).status_code, 200
        )
        stale = {
            "contract_version": "1",
            "event_id": "integration-stale-payment",
            "event_type": "payment.status_changed",
            "occurred_at": timezone.now().isoformat(),
            "revision": 1,
            "order": {
                "id": event["order"]["id"],
                "status": "authorized",
                "buyer": event["order"]["buyer"],
                "seller": event["order"]["seller"],
                "payment": {"status": "paid", "reference": "PAY-STALE"},
            },
        }

        response = self.signed_request("POST", self.order_event_path, stale)

        self.assertEqual(response.status_code, 409)
        shipment = Shipment.objects.get()
        self.assertEqual(shipment.payment_status, Shipment.PaymentStatus.UNAVAILABLE)
        self.assertEqual(
            MarketplaceOrderAuthorization.objects.get().source_revision, 2
        )

    def test_signed_payment_update_is_mirrored_without_changing_fee_agreement(self):
        event = self.authorized_event()
        self.assertEqual(
            self.signed_request("POST", self.order_event_path, event).status_code, 200
        )
        payment_event = {
            "contract_version": "1",
            "event_id": "integration-payment-update",
            "event_type": "payment.status_changed",
            "occurred_at": timezone.now().isoformat(),
            "revision": 2,
            "order": {
                "id": event["order"]["id"],
                "status": "authorized",
                "buyer": event["order"]["buyer"],
                "seller": event["order"]["seller"],
                "payment": {"status": "paid", "reference": "MARKET-PAYMENT-7"},
            },
        }

        response = self.signed_request(
            "POST", self.order_event_path, payment_event
        )

        shipment = Shipment.objects.get()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(shipment.payment_status, Shipment.PaymentStatus.PAID)
        self.assertEqual(
            shipment.marketplace_payment_reference, "MARKET-PAYMENT-7"
        )
        self.assertEqual(
            shipment.payment_status_updated_at,
            MarketplaceOrderAuthorization.objects.get().source_updated_at,
        )
        self.assertEqual(
            shipment.fee_agreement_status, Shipment.FeeAgreementStatus.PENDING
        )
        self.assertTrue(
            AuditEvent.objects.filter(
                action="marketplace.payment_status_synchronized",
                object_id=str(shipment.pk),
                details__payment_status=Shipment.PaymentStatus.PAID,
            ).exists()
        )

    def test_browser_cannot_forge_payment_success(self):
        self.client.force_authenticate(user=self.buyer)
        payload = shipment_request_payload("BROWSER-FORGED-PAYMENT")
        payload["payment_status"] = Shipment.PaymentStatus.PAID

        response = self.client.post("/api/shipments/", payload, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        shipment = Shipment.objects.get(
            external_order_reference="BROWSER-FORGED-PAYMENT"
        )
        self.assertEqual(
            shipment.payment_status, Shipment.PaymentStatus.UNAVAILABLE
        )

    def test_invalid_signed_payload_is_audited_and_rejected(self):
        event = self.authorized_event()
        del event["order"]["delivery_fee"]

        response = self.signed_request("POST", self.order_event_path, event)

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Shipment.objects.exists())
        self.assertTrue(
            AuditEvent.objects.filter(
                action="marketplace.integration_payload_rejected",
                details__reason="schema_validation",
            ).exists()
        )

    def test_invalid_and_expired_signatures_are_rejected(self):
        event = self.authorized_event()
        timestamp = str(int(time.time()) - 301)

        response = self.signed_request(
            "POST", self.order_event_path, event, timestamp=timestamp
        )

        self.assertEqual(response.status_code, 401)
        self.assertFalse(Shipment.objects.exists())
        self.assertTrue(
            AuditEvent.objects.filter(
                action="marketplace.integration_auth_rejected",
                details__reason="timestamp_out_of_window",
            ).exists()
        )

    def test_tampered_signature_disabled_feature_and_large_body_fail_closed(self):
        event = self.authorized_event()
        bad_signature = self.signed_request(
            "POST",
            self.order_event_path,
            event,
            corrupt_signature=True,
        )
        self.assertEqual(bad_signature.status_code, 401)
        self.assertFalse(Shipment.objects.exists())

        with self.settings(MARKETPLACE_INTEGRATION_ENABLED=False):
            disabled = self.signed_request(
                "POST",
                self.order_event_path,
                self.authorized_event("integration-disabled"),
            )
        self.assertEqual(disabled.status_code, 503)

        too_large = self.signed_request(
            "POST",
            self.order_event_path,
            {"event_id": "oversized", "large": "x" * 5000},
        )
        self.assertEqual(too_large.status_code, 400)
        self.assertTrue(
            AuditEvent.objects.filter(
                action="marketplace.integration_request_rejected",
                details__reason="body_too_large",
            ).exists()
        )

    def test_unsupported_external_payment_status_is_not_applied(self):
        event = self.authorized_event()
        event["order"]["payment"] = {"status": "successful"}

        response = self.signed_request("POST", self.order_event_path, event)

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Shipment.objects.exists())

    @patch(
        "logistics.marketplace_integration.create_shipment_offers",
        side_effect=RuntimeError("temporary internal processing failure"),
    )
    def test_failed_processing_rolls_back_for_same_event_retry(self, _mock_offers):
        event = self.authorized_event("integration-retry-after-rollback")
        self.client.raise_request_exception = False
        try:
            failed = self.signed_request("POST", self.order_event_path, event)
        finally:
            self.client.raise_request_exception = True
        self.assertEqual(failed.status_code, 500)
        self.assertFalse(Shipment.objects.exists())
        self.assertFalse(
            MarketplaceIntegrationEvent.objects.filter(
                event_id=event["event_id"]
            ).exists()
        )

        with patch(
            "logistics.marketplace_integration.create_shipment_offers",
            return_value=0,
        ):
            retried = self.signed_request("POST", self.order_event_path, event)

        self.assertEqual(retried.status_code, 200, retried.data)
        self.assertTrue(
            MarketplaceIntegrationEvent.objects.get(
                event_id=event["event_id"]
            ).applied
        )

    def test_order_cancellation_is_applied_only_through_allowed_transition(self):
        event = self.authorized_event()
        created = self.signed_request("POST", self.order_event_path, event)
        cancellation = {
            "contract_version": "1",
            "event_id": "integration-order-cancelled",
            "event_type": "order.cancelled",
            "occurred_at": timezone.now().isoformat(),
            "revision": 2,
            "order": {
                "id": event["order"]["id"],
                "status": "cancelled",
                "buyer": event["order"]["buyer"],
                "seller": event["order"]["seller"],
                "cancellation_reason": "Marketplace order cancelled.",
            },
        }

        response = self.signed_request(
            "POST", self.order_event_path, cancellation
        )

        shipment = Shipment.objects.get(pk=created.data["shipment_id"])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(shipment.status, Shipment.Status.CANCELLED)
        self.assertEqual(
            MarketplaceOrderAuthorization.objects.get().status,
            MarketplaceOrderAuthorization.Status.INELIGIBLE,
        )
        self.assertTrue(
            ShipmentTransition.objects.filter(
                shipment=shipment,
                to_status=Shipment.Status.CANCELLED,
                actor__isnull=True,
            ).exists()
        )

    def test_marketplace_cannot_cancel_after_driver_assignment(self):
        self.driver, _ = create_eligible_shipment_driver(
            "integration-assigned-driver"
        )
        canonical_driver_id = uuid.uuid4()
        self.driver.external_user_id = str(canonical_driver_id)
        self.driver.save(update_fields=["external_user_id"])
        synchronized = self.signed_request(
            "POST",
            self.v2_event_path,
            self.v2_driver_authorization_event(
                canonical_user_id=canonical_driver_id
            ),
        )
        self.assertEqual(synchronized.status_code, 200, synchronized.data)
        event = self.authorized_event()
        created = self.signed_request("POST", self.order_event_path, event)
        shipment_id = created.data["shipment_id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id)
        proposal = ShipmentFeeProposal.objects.get(shipment_id=shipment_id)
        self.client.force_authenticate(user=self.driver)
        assigned = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {"proposal_id": proposal.pk, "version": proposal.version},
            format="json",
        )
        self.assertEqual(assigned.status_code, 200, assigned.data)
        cancellation = {
            "contract_version": "1",
            "event_id": "integration-cancel-after-assignment",
            "event_type": "order.cancelled",
            "occurred_at": timezone.now().isoformat(),
            "revision": 2,
            "order": {
                "id": event["order"]["id"],
                "status": "cancelled",
                "buyer": event["order"]["buyer"],
                "seller": event["order"]["seller"],
                "cancellation_reason": "Late marketplace cancellation.",
            },
        }

        response = self.signed_request(
            "POST", self.order_event_path, cancellation
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            Shipment.objects.get(pk=shipment_id).status, Shipment.Status.ASSIGNED
        )

    def test_outbound_events_are_cursor_replayable_and_exclude_private_fields(self):
        event = self.authorized_event()
        created = self.signed_request("POST", self.order_event_path, event)
        path = "/api/integrations/v1/shipment-events/?after_id=0&limit=10"

        response = self.signed_request(
            "GET", path, request_id="integration-poll-1"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertGreaterEqual(len(response.data["results"]), 1)
        item = next(
            result
            for result in response.data["results"]
            if result["shipment_id"] == created.data["shipment_id"]
        )
        self.assertEqual(item["event_type"], "order.authorized")
        self.assertIn("event_id", item)
        response_json = response.content.decode("utf-8")
        self.assertNotIn("pickup_address", response_json)
        self.assertNotIn("destination_address", response_json)
        self.assertNotIn(self.buyer.email, response_json)
        later_path = (
            "/api/integrations/v1/shipment-events/"
            f"?after_id={response.data['next_cursor']}&limit=10"
        )
        next_page = self.signed_request(
            "GET", later_path, request_id="integration-poll-2"
        )
        self.assertEqual(next_page.status_code, 200)
        self.assertFalse(next_page.data["results"])

    def test_service_can_update_existing_unverified_browser_request(self):
        self.client.force_authenticate(user=self.buyer)
        standalone = shipment_request_payload("MAIN-MARKET-ORDER-1")
        created = self.client.post("/api/shipments/", standalone, format="json")
        self.assertEqual(created.status_code, 201)
        event = self.authorized_event()

        integrated = self.signed_request("POST", self.order_event_path, event)

        shipment = Shipment.objects.get(external_order_reference="MAIN-MARKET-ORDER-1")
        self.assertEqual(integrated.status_code, 200, integrated.data)
        self.assertEqual(shipment.buyer_id, self.buyer.pk)
        self.assertEqual(shipment.seller_id, self.seller.pk)
        self.assertTrue(shipment.order_verified)
        self.assertEqual(shipment.status, Shipment.Status.FEE_PROPOSED)
        self.assertEqual(
            shipment.pickup_address, event["order"]["shipment"]["pickup_address"]
        )
        self.assertEqual(shipment.current_fee_proposal_version, 1)

@override_settings(DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"])
class ShipmentWorkflowApiTests(ShipmentWorkflowApiTests):
    def test_counterproposal_is_an_explicit_two_party_agreement_and_single_assignment(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        self.client.force_authenticate(user=self.driver)
        counter = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/fee-counterproposal/",
            {"amount": "300.00", "currency": "ETB"},
            format="json",
        )
        self.assertEqual(counter.status_code, 201)
        self.assertEqual(
            Shipment.objects.get(pk=shipment_id).status, Shipment.Status.NEGOTIATING
        )

        self.client.force_authenticate(user=self.buyer)
        accepted = self.client.post(
            f"/api/shipments/{shipment_id}/fee-proposals/{counter.data['id']}/accept/",
            {"version": counter.data["version"]},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200)
        shipment = Shipment.objects.get(pk=shipment_id)
        self.assertEqual(shipment.status, Shipment.Status.ASSIGNED)
        self.assertEqual(shipment.assigned_driver_id, self.driver.pk)
        self.assertEqual(
            shipment.fee_agreement_status,
            Shipment.FeeAgreementStatus.AGREED,
        )
        self.assertEqual(accepted.data["current_fee"]["amount"], Decimal("300.00"))
        self.assertEqual(ShipmentFeeAgreement.objects.filter(shipment=shipment).count(), 1)
        fee_event = MarketplaceShipmentEvent.objects.get(
            shipment=shipment,
            event_type="delivery_fee.agreed",
        )
        agreement = ShipmentFeeAgreement.objects.get(shipment=shipment)
        self.assertEqual(
            fee_event.details,
            {
                "amount": "300.00",
                "currency": "ETB",
                "proposal_version": counter.data["version"],
                "buyer_accepted_at": agreement.buyer_accepted_at.isoformat(),
                "driver_accepted_at": agreement.driver_accepted_at.isoformat(),
            },
        )
        self.assertTrue(
            AuditEvent.objects.filter(
                action="shipment.fee_proposal_accepted",
                object_id=str(counter.data["id"]),
            ).exists()
        )
        self.assertEqual(
            list(shipment.transitions.values_list("to_status", flat=True)),
            [
                Shipment.Status.FEE_PROPOSED,
                Shipment.Status.NEGOTIATING,
                Shipment.Status.FEE_AGREED,
                Shipment.Status.OFFERED,
                Shipment.Status.ASSIGNED,
            ],
        )
        self.assertEqual(
            self.client.post(
                f"/api/shipments/{shipment_id}/fee-proposals/{counter.data['id']}/accept/",
                {"version": counter.data["version"]},
                format="json",
            ).status_code,
            409,
        )

    def test_only_current_fee_proposal_version_can_be_accepted(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        original = ShipmentFeeProposal.objects.get(
            shipment_id=shipment_id, proposed_by=self.buyer
        )
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        self.client.force_authenticate(user=self.driver)
        counter = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/fee-counterproposal/",
            {"amount": "300.00", "currency": "ETB"},
            format="json",
        )
        self.assertEqual(counter.status_code, 201)
        self.assertEqual(counter.data["version"], 2)
        counter_audit = AuditEvent.objects.get(
            action="shipment.fee_counterproposed",
            object_id=str(counter.data["id"]),
        )
        self.assertEqual(counter_audit.details["version"], 2)
        self.assertEqual(
            ShipmentFeeProposal.objects.get(pk=original.pk).status,
            ShipmentFeeProposal.Status.SUPERSEDED,
        )

        self.client.force_authenticate(user=self.buyer)
        amended = self.client.post(
            f"/api/shipments/{shipment_id}/fee-proposals/",
            {"amount": "275.00", "currency": "ETB"},
            format="json",
        )
        self.assertEqual(amended.status_code, 201)
        self.assertEqual(amended.data["version"], 3)
        self.assertEqual(
            ShipmentFeeProposal.objects.get(pk=counter.data["id"]).status,
            ShipmentFeeProposal.Status.SUPERSEDED,
        )

        stale = self.client.post(
            f"/api/shipments/{shipment_id}/fee-proposals/{counter.data['id']}/accept/",
            {"version": counter.data["version"]},
            format="json",
        )
        self.assertEqual(stale.status_code, 409)
        stale_rejection = self.client.post(
            f"/api/shipments/{shipment_id}/fee-proposals/{counter.data['id']}/reject/",
            {
                "version": counter.data["version"],
                "reason": "This proposal is already stale.",
            },
            format="json",
        )
        self.assertEqual(stale_rejection.status_code, 409)
        self.client.force_authenticate(user=self.driver)
        stale_buyer_offer = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {"proposal_id": original.pk, "version": original.version},
            format="json",
        )
        self.assertEqual(stale_buyer_offer.status_code, 409)
        self.assertIsNone(Shipment.objects.get(pk=shipment_id).assigned_driver_id)

    def test_suspended_driver_cannot_accept_an_existing_offer(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        buyer_proposal = ShipmentFeeProposal.objects.get(
            shipment_id=shipment_id, proposed_by=self.buyer
        )
        self.application.status = DriverApplication.Status.SUSPENDED
        self.application.save(update_fields=["status"])
        self.client.force_authenticate(user=self.driver)
        result = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {"proposal_id": buyer_proposal.pk, "version": buyer_proposal.version},
            format="json",
        )
        self.assertEqual(result.status_code, 400)
        self.assertIsNone(Shipment.objects.get(pk=shipment_id).assigned_driver_id)

    def test_offer_list_withdraws_offer_when_driver_becomes_ineligible(self):
        second_driver, application = create_eligible_shipment_driver(
            "newly-suspended-driver"
        )
        response = self.create_request()
        offer = ShipmentOffer.objects.get(
            shipment_id=response.data["id"], driver=second_driver
        )
        application.status = DriverApplication.Status.SUSPENDED
        application.save(update_fields=["status"])

        self.client.force_authenticate(user=second_driver)
        visible_offers = self.client.get("/api/drivers/me/shipment-offers/")

        self.assertEqual(visible_offers.status_code, 200)
        self.assertEqual(visible_offers.data, [])
        offer.refresh_from_db()
        self.assertEqual(offer.status, ShipmentOffer.Status.WITHDRAWN)

    def test_unoffered_driver_and_nonowning_buyer_cannot_act_on_shipment(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        unapproved_driver, _ = create_application(
            "unoffered-driver",
            status=DriverApplication.Status.SUBMITTED,
            service_region="North",
        )
        self.client.force_authenticate(user=unapproved_driver)
        self.assertEqual(self.client.get("/api/drivers/me/shipment-offers/").data, [])
        hidden_offer_action = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {
                "proposal_id": ShipmentFeeProposal.objects.get(
                    shipment_id=shipment_id, proposed_by=self.buyer
                ).pk,
                "version": 1,
            },
            format="json",
        )
        self.assertEqual(hidden_offer_action.status_code, 404)

        other_buyer = create_buyer("nonowning-fee-buyer", LogisticsUser.Role.RETAILER)
        self.client.force_authenticate(user=other_buyer)
        unauthorized_proposal = self.client.post(
            f"/api/shipments/{shipment_id}/fee-proposals/",
            {"amount": "275.00", "currency": "ETB"},
            format="json",
        )
        self.assertEqual(unauthorized_proposal.status_code, 404)
        self.assertEqual(
            Shipment.objects.get(pk=shipment_id).current_fee_proposal_version,
            1,
        )

    def test_expired_offer_cannot_be_accepted(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        offer.expires_at = timezone.now() - timedelta(seconds=1)
        offer.save(update_fields=["expires_at"])
        proposal = ShipmentFeeProposal.objects.get(
            shipment_id=shipment_id, proposed_by=self.buyer
        )
        self.client.force_authenticate(user=self.driver)
        result = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {"proposal_id": proposal.pk, "version": proposal.version},
            format="json",
        )
        self.assertEqual(result.status_code, 409)
        self.assertIsNone(Shipment.objects.get(pk=shipment_id).assigned_driver_id)

    def test_failed_agreement_creation_rolls_back_assignment_and_status(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        proposal = ShipmentFeeProposal.objects.get(
            shipment_id=shipment_id, proposed_by=self.buyer
        )
        self.client.force_authenticate(user=self.driver)
        with patch(
            "logistics.shipment_services.ShipmentFeeAgreement.save",
            side_effect=RuntimeError("simulated persistence failure"),
        ):
            with self.assertRaisesRegex(RuntimeError, "simulated persistence failure"):
                self.client.post(
                    f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
                    {"proposal_id": proposal.pk, "version": proposal.version},
                    format="json",
                )

        shipment = Shipment.objects.get(pk=shipment_id)
        proposal.refresh_from_db()
        offer.refresh_from_db()
        self.assertIsNone(shipment.assigned_driver_id)
        self.assertEqual(shipment.status, Shipment.Status.FEE_PROPOSED)
        self.assertEqual(
            shipment.fee_agreement_status,
            Shipment.FeeAgreementStatus.PENDING,
        )
        self.assertEqual(proposal.status, ShipmentFeeProposal.Status.PROPOSED)
        self.assertEqual(offer.status, ShipmentOffer.Status.PENDING)
        self.assertFalse(ShipmentFeeAgreement.objects.filter(shipment=shipment).exists())
        self.assertFalse(
            AuditEvent.objects.filter(
                action="shipment.fee_proposal_accepted",
                object_id=str(proposal.pk),
            ).exists()
        )

    def test_rejecting_counterproposal_requires_and_records_reason(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        self.client.force_authenticate(user=self.driver)
        counter = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/fee-counterproposal/",
            {"amount": "300.00", "currency": "ETB"},
            format="json",
        )
        self.assertEqual(counter.status_code, 201)

        self.client.force_authenticate(user=self.buyer)
        reject_url = (
            f"/api/shipments/{shipment_id}/fee-proposals/"
            f"{counter.data['id']}/reject/"
        )
        self.assertEqual(
            self.client.post(
                reject_url,
                {
                    "version": counter.data["version"],
                    "reason": "This offer is no longer suitable.",
                },
                format="json",
            ).status_code,
            200,
        )
        rejected = ShipmentFeeProposal.objects.get(pk=counter.data["id"])
        self.assertEqual(rejected.status, ShipmentFeeProposal.Status.REJECTED)
        self.assertEqual(rejected.response_reason, "This offer is no longer suitable.")
        self.assertTrue(
            AuditEvent.objects.filter(
                action="shipment.fee_counterproposal_rejected",
                object_id=str(rejected.pk),
            ).exists()
        )

    def test_rejecting_counterproposal_requires_reason(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        self.client.force_authenticate(user=self.driver)
        counter = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/fee-counterproposal/",
            {"amount": "300.00", "currency": "ETB"},
            format="json",
        )
        self.assertEqual(counter.status_code, 201)

        self.client.force_authenticate(user=self.buyer)
        reject_url = f"/api/shipments/{shipment_id}/fee-proposals/{counter.data['id']}/reject/"
        rejected = self.client.post(
            reject_url,
            {"version": counter.data["version"], "reason": ""},
            format="json",
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(
            ShipmentFeeProposal.objects.get(pk=counter.data["id"]).status,
            ShipmentFeeProposal.Status.PROPOSED,
        )

    def test_driver_can_accept_buyer_fee_and_competing_offers_are_withdrawn(self):
        other_driver, _ = create_eligible_shipment_driver("second-matching-driver")
        response = self.create_request()
        shipment_id = response.data["id"]
        self.client.force_authenticate(user=self.driver)
        offers = self.client.get("/api/drivers/me/shipment-offers/")
        offer = next(item for item in offers.data if item["shipment_id"] == shipment_id)
        proposal = ShipmentFeeProposal.objects.get(
            shipment_id=shipment_id,
            version=offer["fee_proposal"]["version"],
        )
        accepted = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer['id']}/accept/",
            {"proposal_id": proposal.pk, "version": proposal.version},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.data["assigned_driver_username"], self.driver.username)
        self.assertEqual(
            ShipmentOffer.objects.get(shipment_id=shipment_id, driver=other_driver).status,
            ShipmentOffer.Status.WITHDRAWN,
        )
        self.client.force_authenticate(user=other_driver)
        competing_offer = ShipmentOffer.objects.get(
            shipment_id=shipment_id, driver=other_driver
        )
        competitor_result = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{competing_offer.pk}/accept/",
            {"proposal_id": proposal.pk, "version": proposal.version},
            format="json",
        )
        self.assertEqual(competitor_result.status_code, 409)
        self.assertIn("another driver", competitor_result.data["detail"].lower())
        self.assertIn("Private farm gate", str(accepted.data["pickup_address"]))

    def test_status_progress_requires_evidence_and_attempt_does_not_confirm_delivery(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        buyer_proposal = ShipmentFeeProposal.objects.get(
            shipment_id=shipment_id, proposed_by=self.buyer
        )
        self.assertEqual(offer.status, ShipmentOffer.Status.PENDING)
        self.client.force_authenticate(user=self.driver)
        assigned = self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {"proposal_id": buyer_proposal.pk, "version": buyer_proposal.version},
            format="json",
        )
        self.assertEqual(assigned.status_code, 200)
        buyer_proposal.refresh_from_db()
        self.assertEqual(buyer_proposal.status, ShipmentFeeProposal.Status.ACCEPTED)

        invalid_jump = self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {"status": Shipment.Status.IN_TRANSIT},
            format="json",
        )
        self.assertEqual(invalid_jump.status_code, 400)
        pickup_pending = self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {"status": Shipment.Status.PICKUP_PENDING},
            format="json",
        )
        self.assertEqual(pickup_pending.status_code, 200)
        pickup_arrival = self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {"status": Shipment.Status.PICKUP_ARRIVED},
            format="json",
        )
        self.assertEqual(pickup_arrival.status_code, 200)
        no_pickup_evidence = self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {"status": Shipment.Status.PICKED_UP},
            format="json",
        )
        self.assertEqual(no_pickup_evidence.status_code, 400)

        upload = self.client.post(
            f"/api/shipments/{shipment_id}/evidence/",
            {
                "evidence_type": ShipmentEvidence.Type.PICKUP,
                "file": SimpleUploadedFile(
                    "pickup.pdf", b"%PDF-1.4 pickup", content_type="application/pdf"
                ),
                "description": "Pickup note",
            },
            format="multipart",
        )
        self.assertEqual(upload.status_code, 201, upload.data)
        self.assertEqual(
            self.client.post(
                f"/api/shipments/{shipment_id}/status/",
                {"status": Shipment.Status.PICKED_UP},
                format="json",
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(
                f"/api/shipments/{shipment_id}/status/",
                {"status": Shipment.Status.IN_TRANSIT},
                format="json",
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(
                f"/api/shipments/{shipment_id}/status/",
                {
                    "status": Shipment.Status.DELIVERY_ATTEMPTED,
                    "reason": "Recipient unavailable",
                },
                format="json",
            ).status_code,
            400,
        )
        evidence = self.client.post(
            f"/api/shipments/{shipment_id}/evidence/",
            {
                "evidence_type": ShipmentEvidence.Type.DELIVERY_ATTEMPT,
                "file": SimpleUploadedFile(
                    "attempt.pdf", b"%PDF-1.4 attempt", content_type="application/pdf"
                ),
            },
            format="multipart",
        )
        self.assertEqual(evidence.status_code, 201)
        attempted = self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {
                "status": Shipment.Status.DELIVERY_ATTEMPTED,
                "reason": "Recipient unavailable",
            },
            format="json",
        )
        self.assertEqual(attempted.status_code, 200)

        self.client.force_authenticate(user=self.buyer)
        premature = self.client.post(
            f"/api/shipments/{shipment_id}/confirm-delivery/", {}, format="json"
        )
        self.assertEqual(premature.status_code, 400)
        self.assertEqual(
            Shipment.objects.get(pk=shipment_id).status,
            Shipment.Status.DELIVERY_ATTEMPTED,
        )

    def test_delivery_confirmation_requires_driver_request_and_buyer_receipt(self):
        shipment_id = self.assign_request("DELIVERY-CONFIRM-ORDER")
        self.advance_to_transit(shipment_id)
        delivery_evidence = self.client.post(
            f"/api/shipments/{shipment_id}/evidence/",
            {
                "evidence_type": ShipmentEvidence.Type.DELIVERY_CONFIRMATION,
                "file": SimpleUploadedFile(
                    "delivery.pdf",
                    b"%PDF-1.4 delivery confirmation",
                    content_type="application/pdf",
                ),
                "description": "Delivery acknowledgment",
            },
            format="multipart",
        )
        self.assertEqual(delivery_evidence.status_code, 201)
        request_confirmation = self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {
                "status": Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
            },
            format="json",
        )
        self.assertEqual(request_confirmation.status_code, 200)
        self.assertEqual(
            Shipment.objects.get(pk=shipment_id).status,
            Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
        )

        self.client.force_authenticate(user=self.driver)
        driver_cannot_mark_delivered = self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {"status": Shipment.Status.DELIVERED},
            format="json",
        )
        self.assertEqual(driver_cannot_mark_delivered.status_code, 400)
        driver_confirmation = self.client.post(
            f"/api/shipments/{shipment_id}/confirm-delivery/", {}, format="json"
        )
        self.assertEqual(driver_confirmation.status_code, 403)
        self.client.force_authenticate(user=self.buyer)
        receipt = self.client.post(
            f"/api/shipments/{shipment_id}/confirm-delivery/", {}, format="json"
        )
        self.assertEqual(receipt.status_code, 200)
        self.assertEqual(receipt.data["status"], Shipment.Status.DELIVERED)
        self.assertEqual(receipt.data["payment_status"], Shipment.PaymentStatus.UNAVAILABLE)
        self.assertTrue(
            ShipmentTransition.objects.filter(
                shipment_id=shipment_id,
                from_status=Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
                to_status=Shipment.Status.DELIVERED,
                actor=self.buyer,
            ).exists()
        )
        self.assertTrue(
            AuditEvent.objects.filter(
                action="shipment.status_changed",
                object_id=str(shipment_id),
                details__to_status=Shipment.Status.DELIVERED,
            ).exists()
        )

    @override_settings(
        SHIPMENT_REQUIRE_PICKUP_EVIDENCE=False,
        SHIPMENT_REQUIRE_DELIVERY_EVIDENCE=False,
    )
    def test_evidence_can_be_omitted_only_when_configured_policy_allows_it(self):
        shipment_id = self.assign_request("OPTIONAL-EVIDENCE-ORDER")
        for target in (
            Shipment.Status.PICKUP_PENDING,
            Shipment.Status.PICKUP_ARRIVED,
            Shipment.Status.PICKED_UP,
            Shipment.Status.IN_TRANSIT,
            Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
        ):
            response = self.client.post(
                f"/api/shipments/{shipment_id}/status/",
                {"status": target},
                format="json",
            )
            self.assertEqual(response.status_code, 200, response.data)
        self.client.force_authenticate(user=self.buyer)
        receipt = self.client.post(
            f"/api/shipments/{shipment_id}/confirm-delivery/", {}, format="json"
        )
        self.assertEqual(receipt.status_code, 200)
        self.assertEqual(receipt.data["status"], Shipment.Status.DELIVERED)
        self.assertEqual(receipt.data["evidence_requirements"]["pickup"], False)
        self.assertEqual(receipt.data["evidence_requirements"]["delivery"], False)

        self.client.force_authenticate(user=self.driver)
        driver_notifications = self.client.get(
            "/api/shipments/notifications/?limit=50"
        )
        self.assertEqual(driver_notifications.status_code, 200)
        self.assertIn(
            Shipment.Status.DELIVERED,
            [item["event_type"] for item in driver_notifications.data["results"]],
        )
        read_notification = driver_notifications.data["results"][0]
        self.assertIsNone(read_notification["read_at"])
        self.assertEqual(
            self.client.post(
                f"/api/shipments/notifications/{read_notification['id']}/read/",
                {},
                format="json",
            ).status_code,
            200,
        )
        outsider = create_buyer("shipment-notification-outsider", LogisticsUser.Role.RETAILER)
        self.client.force_authenticate(user=outsider)
        self.assertEqual(
            self.client.post(
                f"/api/shipments/notifications/{read_notification['id']}/read/",
                {},
                format="json",
            ).status_code,
            404,
        )

    def test_buyer_can_report_delivery_problem_into_dispute(self):
        shipment_id = self.assign_request("DELIVERY-PROBLEM-ORDER")
        self.advance_to_transit(shipment_id)
        self.client.post(
            f"/api/shipments/{shipment_id}/evidence/",
            {
                "evidence_type": ShipmentEvidence.Type.DELIVERY_CONFIRMATION,
                "file": SimpleUploadedFile(
                    "delivery.pdf", b"%PDF-1.4 delivery", content_type="application/pdf"
                ),
            },
            format="multipart",
        )
        self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {"status": Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED},
            format="json",
        )
        self.client.force_authenticate(user=self.buyer)
        problem = self.client.post(
            f"/api/shipments/{shipment_id}/delivery-problem/",
            {"reason": "The package arrived damaged."},
            format="json",
        )
        self.assertEqual(problem.status_code, 200)
        self.assertEqual(problem.data["status"], Shipment.Status.DISPUTED)
        self.assertEqual(problem.data["payment_status"], Shipment.PaymentStatus.UNAVAILABLE)
        self.assertTrue(
            ShipmentException.objects.filter(
                shipment_id=shipment_id,
                reported_by=self.buyer,
                reason="The package arrived damaged.",
            ).exists()
        )

    def test_failed_delivery_reschedule_is_audited_and_reenters_transit(self):
        shipment_id = self.assign_request("DELIVERY-RESCHEDULE-ORDER")
        self.advance_to_transit(shipment_id)
        self.client.post(
            f"/api/shipments/{shipment_id}/evidence/",
            {
                "evidence_type": ShipmentEvidence.Type.DELIVERY_ATTEMPT,
                "file": SimpleUploadedFile(
                    "attempt.pdf", b"%PDF-1.4 attempt", content_type="application/pdf"
                ),
            },
            format="multipart",
        )
        attempt = self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {
                "status": Shipment.Status.DELIVERY_ATTEMPTED,
                "reason": "Recipient unavailable",
            },
            format="json",
        )
        self.assertEqual(attempt.status_code, 200)
        eta = timezone.now() + timedelta(days=2)
        naive_eta = eta.replace(tzinfo=None).isoformat()
        missing_timezone = self.client.post(
            f"/api/shipments/{shipment_id}/reschedule/",
            {
                "estimated_delivery_at": naive_eta,
                "reason": "This time has no timezone.",
            },
            format="json",
        )
        self.assertEqual(missing_timezone.status_code, 400)
        rescheduled = self.client.post(
            f"/api/shipments/{shipment_id}/reschedule/",
            {
                "estimated_delivery_at": eta.isoformat(),
                "reason": "Buyer arranged another receiving time.",
            },
            format="json",
        )
        self.assertEqual(rescheduled.status_code, 200)
        self.assertEqual(rescheduled.data["status"], Shipment.Status.IN_TRANSIT)
        self.assertEqual(
            rescheduled.data["exceptions"][-1]["exception_type"],
            ShipmentException.Type.FAILED_DELIVERY,
        )
        self.assertTrue(
            ShipmentTransition.objects.filter(
                shipment_id=shipment_id,
                from_status=Shipment.Status.DELIVERY_ATTEMPTED,
                to_status=Shipment.Status.IN_TRANSIT,
                reason="Rescheduled: Buyer arranged another receiving time.",
            ).exists()
        )
        self.assertTrue(
            AuditEvent.objects.filter(
                action="shipment.rescheduled", details__shipment_id=shipment_id
            ).exists()
        )

    def test_shipment_messages_are_paginated_and_not_visible_to_outsiders(self):
        shipment_id = self.assign_request("SHIPMENT-MESSAGE-PAGE-ORDER")
        shipment = Shipment.objects.get(pk=shipment_id)
        for body in ("First coordination message", "Second coordination message", "Third coordination message"):
            ShipmentMessage.objects.create(
                shipment=shipment,
                sender=self.buyer,
                body=body,
            )
        self.client.force_authenticate(user=self.buyer)
        first_page = self.client.get(
            f"/api/shipments/{shipment_id}/messages/?limit=2"
        )
        self.assertEqual(first_page.status_code, 200)
        self.assertEqual(first_page.data["count"], 5)
        self.assertEqual(len(first_page.data["results"]), 2)
        self.assertIsNotNone(first_page.data["next"])
        next_page = self.client.get(
            f"/api/shipments/{shipment_id}/messages/?limit=2&offset=4"
        )
        self.assertEqual(len(next_page.data["results"]), 1)

        outsider = create_buyer("shipment-message-outsider", LogisticsUser.Role.RETAILER)
        self.client.force_authenticate(user=outsider)
        self.assertEqual(
            self.client.get(
                f"/api/shipments/{shipment_id}/messages/?limit=2"
            ).status_code,
            404,
        )

    def test_message_writes_validate_content_and_notify_only_the_other_participant(self):
        shipment_id = self.assign_request("SHIPMENT-MESSAGE-NOTIFY-ORDER")
        self.client.force_authenticate(user=self.buyer)
        message = self.client.post(
            f"/api/shipments/{shipment_id}/messages/",
            {"body": "Please call before arrival."},
            format="json",
        )
        self.assertEqual(message.status_code, 201)
        self.assertEqual(message.data["body"], "Please call before arrival.")
        empty_message = self.client.post(
            f"/api/shipments/{shipment_id}/messages/",
            {"body": "  "},
            format="json",
        )
        self.assertEqual(empty_message.status_code, 400)
        self.assertFalse(
            AuditEvent.objects.filter(
                action="shipment.message_sent",
                object_id=str(message.data["id"]),
                details__body__isnull=False,
            ).exists()
        )

        self.client.force_authenticate(user=self.driver)
        notifications = self.client.get("/api/shipments/notifications/")
        self.assertIn(
            "message_received",
            [entry["event_type"] for entry in notifications.data["results"]],
        )

    @override_settings(SHIPMENT_EVIDENCE_MAX_BYTES=16)
    def test_evidence_upload_validates_size_signature_and_content_type(self):
        shipment_id = self.assign_request("EVIDENCE-VALIDATION-ORDER")
        self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {"status": Shipment.Status.PICKUP_PENDING},
            format="json",
        )
        self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {"status": Shipment.Status.PICKUP_ARRIVED},
            format="json",
        )
        oversized = self.client.post(
            f"/api/shipments/{shipment_id}/evidence/",
            {
                "evidence_type": ShipmentEvidence.Type.PICKUP,
                "file": SimpleUploadedFile(
                    "large.pdf",
                    b"%PDF-1.4" + b"x" * 20,
                    content_type="application/pdf",
                ),
            },
            format="multipart",
        )
        self.assertEqual(oversized.status_code, 400)
        wrong_content_type = self.client.post(
            f"/api/shipments/{shipment_id}/evidence/",
            {
                "evidence_type": ShipmentEvidence.Type.PICKUP,
                "file": SimpleUploadedFile(
                    "signature.pdf", b"%PDF-1.4 valid", content_type="image/png"
                ),
            },
            format="multipart",
        )
        self.assertEqual(wrong_content_type.status_code, 400)

    def test_evidence_download_is_private_to_shipment_participants(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        self.client.force_authenticate(user=self.driver)
        self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {
                "proposal_id": ShipmentFeeProposal.objects.get(
                    shipment_id=shipment_id, proposed_by=self.buyer
                ).pk,
                "version": 1,
            },
            format="json",
        )
        self.client.post(
            f"/api/shipments/{shipment_id}/status/",
            {"status": Shipment.Status.PICKUP_PENDING},
            format="json",
        )
        upload = self.client.post(
            f"/api/shipments/{shipment_id}/evidence/",
            {
                "evidence_type": ShipmentEvidence.Type.PICKUP,
                "file": SimpleUploadedFile(
                    "pickup.pdf", b"%PDF-1.4 private", content_type="application/pdf"
                ),
            },
            format="multipart",
        )
        self.assertEqual(upload.status_code, 201)
        download = f"/api/shipments/{shipment_id}/evidence/{upload.data['id']}/"
        response_file = self.client.get(download)
        self.assertEqual(response_file.status_code, 200)
        self.assertEqual(response_file["Cache-Control"], "private, no-store")
        response_file.close()
        outsider = create_buyer("evidence-outsider", LogisticsUser.Role.RETAILER)
        self.client.force_authenticate(user=outsider)
        self.assertEqual(self.client.get(download).status_code, 404)

    def test_fee_messages_are_offer_scoped_and_cancellation_requires_a_reason(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)

        self.client.force_authenticate(user=self.driver)
        other_message = self.client.post(
            f"/api/shipments/{shipment_id}/messages/",
            {"body": "Private request", "offer_id": offer.pk + 100},
            format="json",
        )
        self.assertEqual(other_message.status_code, 404)
        private_message = self.client.post(
            f"/api/shipments/{shipment_id}/messages/",
            {"body": "Can the fee be adjusted?", "offer_id": offer.pk},
            format="json",
        )
        self.assertEqual(private_message.status_code, 404)
        candidate_thread = self.client.get(
            f"/api/shipments/{shipment_id}/messages/"
        )
        self.assertEqual(candidate_thread.status_code, 200)
        self.assertEqual(len(candidate_thread.data["results"]), 1)
        self.assertIn("250.00 ETB", candidate_thread.data["results"][0]["body"])

        self.client.force_authenticate(user=self.buyer)
        thread = self.client.get(f"/api/shipments/{shipment_id}/messages/")
        self.assertEqual(thread.status_code, 200)
        self.assertEqual(len(thread.data["results"]), 1)
        missing_reason = self.client.post(
            f"/api/shipments/{shipment_id}/cancel/", {"reason": " "}, format="json"
        )
        self.assertEqual(missing_reason.status_code, 400)
        cancellation = self.client.post(
            f"/api/shipments/{shipment_id}/cancel/",
            {"reason": "Buyer changed plans"},
            format="json",
        )
        self.assertEqual(cancellation.status_code, 200)
        self.assertEqual(cancellation.data["status"], Shipment.Status.CANCELLED)
        self.assertTrue(
            ShipmentTransition.objects.filter(
                shipment_id=shipment_id,
                to_status=Shipment.Status.CANCELLED,
                actor=self.buyer,
                reason="Buyer changed plans",
            ).exists()
        )
        self.client.force_authenticate(user=self.driver)
        cancellation_notifications = self.client.get("/api/shipments/notifications/")
        self.assertIn(
            Shipment.Status.CANCELLED,
            [
                item["event_type"]
                for item in cancellation_notifications.data["results"]
            ],
        )

    def test_dispute_is_a_reasoned_transition_and_financial_manager_has_no_default_access(self):
        response = self.create_request()
        shipment_id = response.data["id"]
        offer = ShipmentOffer.objects.get(shipment_id=shipment_id, driver=self.driver)
        self.client.force_authenticate(user=self.driver)
        self.client.post(
            f"/api/shipments/{shipment_id}/offers/{offer.pk}/accept/",
            {
                "proposal_id": ShipmentFeeProposal.objects.get(
                    shipment_id=shipment_id, proposed_by=self.buyer
                ).pk,
                "version": 1,
            },
            format="json",
        )
        dispute = self.client.post(
            f"/api/shipments/{shipment_id}/dispute/",
            {"reason": "Cargo packaging was damaged"},
            format="json",
        )
        self.assertEqual(dispute.status_code, 200)
        self.assertEqual(dispute.data["status"], Shipment.Status.DISPUTED)

        finance = create_user("shipment-finance", LogisticsUser.Role.FINANCIAL_MANAGER)
        self.client.force_authenticate(user=finance)
        self.assertEqual(self.client.get("/api/shipments/").status_code, 403)
        self.assertEqual(
            self.client.get(f"/api/shipments/{shipment_id}/").status_code, 404
        )
@override_settings(
    DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
    MARKETPLACE_INTEGRATION_ENABLED=False,
)
class ConversationInboxApiTests(PrivateStorageTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.driver, _ = create_eligible_shipment_driver("conversation-driver")
        self.other_driver, _ = create_eligible_shipment_driver("conversation-other")
        self.buyer = create_buyer("conversation-buyer")
        self.stranger = create_user("conversation-stranger", LogisticsUser.Role.DRIVER)
        self.seller = create_user(
            "conversation-seller",
            LogisticsUser.Role.FARMER,
            external_user_id="market-conversation-seller",
        )
        self.shipment = Shipment.objects.create(
            buyer=self.buyer,
            seller=self.seller,
            external_order_reference="CONVERSATION-ORDER-1",
            pickup_region="North",
            destination_region="North",
            product_summary="Two crates of tomatoes",
            status=Shipment.Status.ASSIGNED,
            assigned_driver=self.driver,
        )
        self.client = APIClient()

    def test_assigned_driver_and_buyer_share_the_same_conversation(self):
        self.client.force_authenticate(user=self.driver)
        driver_inbox = self.client.get("/api/conversations/")
        self.assertEqual(driver_inbox.status_code, 200, driver_inbox.data)
        self.assertEqual(driver_inbox.data["count"], 1)
        conversation = driver_inbox.data["conversations"][0]
        self.assertEqual(conversation["shipment_id"], self.shipment.pk)
        self.assertEqual(conversation["kind"], "delivery")
        self.assertTrue(conversation["can_post"])

        self.client.force_authenticate(user=self.buyer)
        buyer_inbox = self.client.get("/api/conversations/")
        self.assertEqual(buyer_inbox.status_code, 200, buyer_inbox.data)
        self.assertEqual(buyer_inbox.data["count"], 1)
        self.assertEqual(
            buyer_inbox.data["conversations"][0]["shipment_id"], self.shipment.pk
        )

    def test_unrelated_account_cannot_read_the_conversation(self):
        self.client.force_authenticate(user=self.other_driver)
        self.assertEqual(
            self.client.get(f"/api/conversations/{self.shipment.pk}/messages/").status_code,
            404,
        )
        self.client.force_authenticate(user=self.stranger)
        self.assertEqual(
            self.client.get(f"/api/conversations/{self.shipment.pk}/messages/").status_code,
            404,
        )
        self.assertEqual(self.client.get("/api/conversations/").data["count"], 0)

    def test_messages_posted_on_the_shipment_appear_in_the_inbox(self):
        self.client.force_authenticate(user=self.driver)
        posted = self.client.post(
            f"/api/shipments/{self.shipment.pk}/messages/",
            {"body": "I am on my way to the pickup point."},
            format="json",
        )
        self.assertEqual(posted.status_code, 201, posted.data)

        inbox = self.client.get("/api/conversations/")
        conversation = inbox.data["conversations"][0]
        self.assertEqual(conversation["unread_count"], 0)
        self.assertEqual(
            conversation["last_message"]["body"], "I am on my way to the pickup point."
        )

        self.client.force_authenticate(user=self.buyer)
        buyer_inbox = self.client.get("/api/conversations/")
        self.assertEqual(buyer_inbox.data["conversations"][0]["unread_count"], 1)

    def test_opening_a_conversation_marks_it_read(self):
        self.client.force_authenticate(user=self.driver)
        self.client.post(
            f"/api/shipments/{self.shipment.pk}/messages/",
            {"body": "Cargo is loaded and secured."},
            format="json",
        )
        self.client.force_authenticate(user=self.buyer)
        self.assertEqual(
            self.client.get("/api/conversations/unread/").data["unread_count"], 1
        )

        opened = self.client.get(f"/api/conversations/{self.shipment.pk}/messages/")
        self.assertEqual(opened.status_code, 200, opened.data)
        self.assertEqual(
            self.client.get("/api/conversations/unread/").data["unread_count"], 0
        )

    def test_pending_offer_driver_sees_only_their_own_offer_thread(self):
        shipment = Shipment.objects.create(
            buyer=self.buyer,
            seller=self.seller,
            external_order_reference="CONVERSATION-ORDER-2",
            pickup_region="North",
            destination_region="North",
            product_summary="One crate of onions",
            status=Shipment.Status.OFFERED,
            order_verified=True,
        )
        offer = ShipmentOffer.objects.create(
            shipment=shipment,
            driver=self.driver,
            expires_at=timezone.now() + timedelta(hours=2),
        )
        ShipmentMessage.objects.create(
            shipment=shipment,
            offer=offer,
            sender=self.buyer,
            body="Are you able to take this load?",
        )
        other_offer = ShipmentOffer.objects.create(
            shipment=shipment,
            driver=self.other_driver,
            expires_at=timezone.now() + timedelta(hours=2),
        )
        ShipmentMessage.objects.create(
            shipment=shipment,
            offer=other_offer,
            sender=self.buyer,
            body="This message is for the other driver.",
        )

        self.client.force_authenticate(user=self.driver)
        inbox = self.client.get("/api/conversations/")
        self.assertEqual(inbox.data["count"], 2)
        conversation = next(
            item
            for item in inbox.data["conversations"]
            if item["shipment_id"] == shipment.pk
        )
        self.assertEqual(conversation["kind"], "offer")
        self.assertFalse(conversation["can_post"])

        messages = self.client.get(f"/api/conversations/{shipment.pk}/messages/")
        self.assertEqual(messages.status_code, 200, messages.data)
        bodies = [item["body"] for item in messages.data["results"]]
        self.assertEqual(bodies, ["Are you able to take this load?"])

    def test_unavailable_driver_keeps_assigned_conversation_access(self):
        self.driver.driver_profile.is_available = False
        self.driver.driver_profile.save(update_fields=["is_available", "updated_at"])

        self.client.force_authenticate(user=self.driver)
        inbox = self.client.get("/api/conversations/")
        self.assertEqual(inbox.data["count"], 1)


@override_settings(
    DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
    MARKETPLACE_INTEGRATION_ENABLED=False,
)
class DriverWalletApiTests(PrivateStorageTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.driver, _ = create_eligible_shipment_driver("wallet-driver")
        self.client = APIClient()
        self.client.force_authenticate(user=self.driver)

    def test_wallet_reports_unlinked_without_a_marketplace_credential(self):
        response = self.client.get("/api/wallet/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["linked"])
        self.assertIsNone(response.data["wallet"])
        self.assertEqual(response.data["transactions"], [])

    def test_wallet_returns_the_marketplace_balance_without_inventing_one(self):
        session = self.client.session
        session["marketplace_access_token"] = "marketplace-token"
        session["marketplace_access_user_id"] = "11111111-1111-1111-1111-111111111111"
        session.save()

        wallet_payload = {
            "currency": "ETB",
            "available_balance": "250.00",
            "held_balance": "0.00",
        }
        with patch("logistics.wallet_views.marketplace_get") as mocked:
            mocked.side_effect = [
                wallet_payload,
                {"results": [{"reference": "DRIVER-FEE-1", "amount": "250.00"}]},
                {"results": [{"status": "pending", "amount": "100.00"}]},
            ]
            response = self.client.get("/api/wallet/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["linked"])
        self.assertEqual(response.data["wallet"], wallet_payload)
        self.assertEqual(
            response.data["transactions"][0]["reference"], "DRIVER-FEE-1"
        )
        self.assertEqual(response.data["payouts"][0]["status"], "pending")
        self.assertEqual(mocked.call_count, 3)

    def test_wallet_summary_derives_all_financial_figures(self):
        session = self.client.session
        session["marketplace_access_token"] = "marketplace-token"
        session["marketplace_access_user_id"] = "11111111-1111-1111-1111-111111111111"
        session.save()

        wallet_payload = {
            "currency": "ETB",
            "available_balance": "250.00",
            "held_balance": "75.00",
            "incoming_total": 900.0,
            "outgoing_total": 650.0,
        }
        with patch("logistics.wallet_views.marketplace_get") as mocked:
            mocked.side_effect = [
                wallet_payload,
                {"results": []},
                {
                    "results": [
                        {"status": "PAID", "amount": "500.00"},
                        {"status": "PENDING", "amount": "75.00"},
                        {"status": "REJECTED", "amount": "20.00"},
                    ]
                },
            ]
            response = self.client.get("/api/wallet/")

        self.assertEqual(response.status_code, 200, response.data)
        summary = response.data["summary"]
        self.assertEqual(summary["available_balance"], "250.00")
        self.assertEqual(summary["pending_balance"], "75.00")
        self.assertEqual(summary["withdrawable_balance"], "250.00")
        self.assertEqual(summary["total_earnings"], "900.00")
        self.assertEqual(summary["total_withdrawn"], "500.00")
        self.assertEqual(summary["pending_withdrawals"], "75.00")
        self.assertEqual(summary["pending_withdrawal_count"], 1)
        self.assertEqual(summary["currency"], "ETB")

    def test_expired_marketplace_credential_is_not_used(self):
        session = self.client.session
        session["marketplace_access_token"] = "marketplace-token"
        session["marketplace_access_expires_at"] = 1.0
        session.save()

        response = self.client.get("/api/wallet/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["linked"])

    def test_non_driver_account_cannot_read_the_driver_wallet(self):
        buyer = create_buyer("wallet-buyer")
        self.client.force_authenticate(user=buyer)

        response = self.client.get("/api/wallet/")

        self.assertEqual(response.status_code, 403)

    def test_payout_request_requires_a_linked_marketplace_session(self):
        response = self.client.post(
            "/api/wallet/payouts/",
            {"amount": "100.00", "destination": "Commercial Bank of Ethiopia 1234"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_fee_agreements_expose_the_driver_side_agreement_and_review(self):
        buyer = create_buyer("wallet-fee-buyer")
        shipment = Shipment.objects.create(
            buyer=buyer,
            seller=create_user(
                "wallet-fee-seller",
                LogisticsUser.Role.FARMER,
                external_user_id="market-wallet-fee-seller",
            ),
            external_order_reference="WALLET-FEE-ORDER-1",
            pickup_region="North",
            destination_region="North",
            product_summary="Cargo",
            status=Shipment.Status.FEE_AGREED,
            fee_agreement_status="agreed",
            assigned_driver=self.driver,
        )
        proposal = ShipmentFeeProposal.objects.create(
            shipment=shipment,
            proposed_by=buyer,
            amount="250.00",
            currency="ETB",
            version=1,
            status=ShipmentFeeProposal.Status.ACCEPTED,
        )
        ShipmentFeeAgreement.objects.create(
            shipment=shipment,
            proposal=proposal,
            buyer=buyer,
            driver=self.driver,
            amount="250.00",
            currency="ETB",
            buyer_accepted_at=timezone.now(),
            driver_accepted_at=timezone.now(),
        )

        response = self.client.get("/api/wallet/fee-agreements/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        agreement = response.data["agreements"][0]
        self.assertEqual(agreement["amount"], "250.00")
        self.assertEqual(agreement["currency"], "ETB")
        self.assertIsNone(agreement["review_decision"])

    def test_payout_request_forwards_the_idempotency_key_to_the_marketplace(self):
        session = self.client.session
        session["marketplace_access_token"] = "marketplace-token"
        session["marketplace_access_user_id"] = "11111111-1111-1111-1111-111111111111"
        session.save()

        with patch("logistics.wallet_views.marketplace_post") as mocked:
            mocked.return_value = {
                "id": "payout-1",
                "amount": "100.00",
                "destination": "Commercial Bank of Ethiopia 1234",
                "status": "pending",
            }
            response = self.client.post(
                "/api/wallet/payouts/",
                {"amount": "100.00", "destination": "Commercial Bank of Ethiopia 1234"},
                format="json",
                HTTP_IDEMPOTENCY_KEY="driver-payout-42",
            )

        self.assertEqual(response.status_code, 201, response.data)
        mocked.assert_called_once()
        call_args = mocked.call_args
        self.assertEqual(call_args.args[0], "/api/v1/wallet/payouts/")
        self.assertEqual(call_args.args[1], "marketplace-token")
        self.assertEqual(call_args.kwargs["headers"], {"Idempotency-Key": "driver-payout-42"})

    def test_payout_request_without_an_idempotency_key_sends_no_extra_header(self):
        session = self.client.session
        session["marketplace_access_token"] = "marketplace-token"
        session["marketplace_access_user_id"] = "11111111-1111-1111-1111-111111111111"
        session.save()

        with patch("logistics.wallet_views.marketplace_post") as mocked:
            mocked.return_value = {"id": "payout-2", "status": "pending"}
            response = self.client.post(
                "/api/wallet/payouts/",
                {"amount": "100.00", "destination": "Commercial Bank of Ethiopia 1234"},
                format="json",
            )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(mocked.call_args.kwargs["headers"])


@override_settings(
    DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
    MARKETPLACE_INTEGRATION_ENABLED=False,
    GREENPATH_MARKETPLACE_API_BASE_URL="http://localhost:8000/api/v1",
    MARKETPLACE_LOGIN_ALLOWED_ORIGINS=["http://localhost:3000"],
)
class MarketplaceCredentialRefreshApiTests(PrivateStorageTestMixin, TestCase):
    CANONICAL_USER_ID = "22222222-2222-2222-2222-222222222222"

    def setUp(self):
        super().setUp()
        self.driver, _ = create_eligible_shipment_driver("refresh-driver")
        self.client = APIClient()
        self.client.force_authenticate(user=self.driver)

    def _link_session(self):
        session = self.client.session
        session["marketplace_access_token"] = "old-marketplace-token"
        session["marketplace_access_user_id"] = self.CANONICAL_USER_ID
        session.save()

    def _identity_response(self, user_id):
        payload = json.dumps(
            {
                "user": {
                    "id": user_id,
                    "role": "DRIVER",
                    "status": "APPROVED",
                }
            }
        ).encode("utf-8")
        response = Mock()
        response.read.return_value = payload
        response.__enter__ = lambda self_: self_
        response.__exit__ = lambda *args: False
        return response

    def test_rotated_marketplace_token_replaces_the_cached_credential(self):
        self._link_session()

        with patch(
            "logistics.marketplace_session_views.urlopen",
            return_value=self._identity_response(self.CANONICAL_USER_ID),
        ) as mocked:
            response = self.client.post(
                "/api/integrations/v2/driver/marketplace-token/",
                {"marketplace_access_token": "new-marketplace-token"},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["refreshed"])
        self.assertEqual(mocked.call_count, 1)
        session = self.client.session
        self.assertEqual(session["marketplace_access_token"], "new-marketplace-token")
        self.assertEqual(session["marketplace_access_user_id"], self.CANONICAL_USER_ID)

    def test_a_token_for_another_marketplace_account_is_rejected(self):
        self._link_session()

        with patch(
            "logistics.marketplace_session_views.urlopen",
            return_value=self._identity_response("33333333-3333-3333-3333-333333333333"),
        ):
            response = self.client.post(
                "/api/integrations/v2/driver/marketplace-token/",
                {"marketplace_access_token": "other-marketplace-token"},
                format="json",
            )

        self.assertEqual(response.status_code, 403, response.data)
        session = self.client.session
        self.assertEqual(session["marketplace_access_token"], "old-marketplace-token")

    def test_refresh_requires_a_linked_marketplace_session(self):
        with patch(
            "logistics.marketplace_session_views.urlopen",
            return_value=self._identity_response(self.CANONICAL_USER_ID),
        ) as mocked:
            response = self.client.post(
                "/api/integrations/v2/driver/marketplace-token/",
                {"marketplace_access_token": "new-marketplace-token"},
                format="json",
            )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(mocked.call_count, 0)

    def test_refresh_rejects_an_untrusted_origin(self):
        self._link_session()

        with patch(
            "logistics.marketplace_session_views.urlopen",
            return_value=self._identity_response(self.CANONICAL_USER_ID),
        ) as mocked:
            response = self.client.post(
                "/api/integrations/v2/driver/marketplace-token/",
                {"marketplace_access_token": "new-marketplace-token"},
                format="json",
                HTTP_ORIGIN="https://attacker.example",
            )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(mocked.call_count, 0)

    def test_refresh_requires_an_authenticated_driver_session(self):
        self.client.force_authenticate(user=None)

        response = self.client.post(
            "/api/integrations/v2/driver/marketplace-token/",
            {"marketplace_access_token": "new-marketplace-token"},
            format="json",
        )

        self.assertIn(response.status_code, (401, 403))

    def test_refresh_accepts_the_rotated_token_in_a_bearer_header(self):
        self._link_session()

        with patch(
            "logistics.marketplace_session_views.urlopen",
            return_value=self._identity_response(self.CANONICAL_USER_ID),
        ):
            response = self.client.post(
                "/api/integrations/v2/driver/marketplace-token/",
                {},
                format="json",
                HTTP_AUTHORIZATION="Bearer header-marketplace-token",
            )

        self.assertEqual(response.status_code, 200, response.data)
        session = self.client.session
        self.assertEqual(session["marketplace_access_token"], "header-marketplace-token")

    def test_refresh_without_any_credential_is_rejected(self):
        self._link_session()

        response = self.client.post(
            "/api/integrations/v2/driver/marketplace-token/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("marketplace_access_token", response.data)


@override_settings(
    DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
    MARKETPLACE_INTEGRATION_ENABLED=False,
    GREENPATH_MARKETPLACE_API_BASE_URL="http://localhost:8000/api/v1",
    MARKETPLACE_LOGIN_ALLOWED_ORIGINS=["http://localhost:3000"],
)
class MarketplaceDriverSessionExchangeTests(PrivateStorageTestMixin, TestCase):
    CANONICAL_USER_ID = "44444444-4444-4444-4444-444444444444"

    def setUp(self):
        super().setUp()
        self.driver, _ = create_eligible_shipment_driver("session-driver")
        self.identity = MarketplaceDriverIdentity.objects.create(
            user=self.driver,
            profile=self.driver.driver_profile,
            marketplace_user_id=self.CANONICAL_USER_ID,
            account_status="APPROVED",
            account_active=True,
            application_status="approved",
            documents_verified=True,
            driver_authorized=True,
            license_expiry=timezone.localdate() + timedelta(days=365),
            last_event_id=uuid.uuid4(),
            payload_sha256=hashlib.sha256(b"session-exchange").hexdigest(),
        )
        self.client = APIClient()

    def _identity_response(self, user_id):
        payload = json.dumps(
            {
                "user": {
                    "id": user_id,
                    "role": "DRIVER",
                    "status": "APPROVED",
                }
            }
        ).encode("utf-8")
        response = Mock()
        response.read.return_value = payload
        response.__enter__ = lambda self_: self_
        response.__exit__ = lambda *args: False
        return response

    def test_session_exchange_accepts_the_token_in_a_bearer_header(self):
        with patch(
            "logistics.marketplace_session_views.urlopen",
            return_value=self._identity_response(self.CANONICAL_USER_ID),
        ):
            response = self.client.post(
                "/api/integrations/v2/driver/session/",
                {},
                format="json",
                HTTP_ORIGIN="http://localhost:3000",
                HTTP_AUTHORIZATION="Bearer marketplace-token",
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["authenticated"])
        session = self.client.session
        self.assertEqual(session["marketplace_access_token"], "marketplace-token")
        self.assertEqual(session["marketplace_access_user_id"], self.CANONICAL_USER_ID)

    def test_session_exchange_accepts_the_token_in_the_body(self):
        with patch(
            "logistics.marketplace_session_views.urlopen",
            return_value=self._identity_response(self.CANONICAL_USER_ID),
        ):
            response = self.client.post(
                "/api/integrations/v2/driver/session/",
                {"marketplace_access_token": "marketplace-token"},
                format="json",
                HTTP_ORIGIN="http://localhost:3000",
            )

        self.assertEqual(response.status_code, 200, response.data)
        session = self.client.session
        self.assertEqual(session["marketplace_access_token"], "marketplace-token")

    def test_session_exchange_rejects_a_disallowed_origin(self):
        with patch(
            "logistics.marketplace_session_views.urlopen",
            return_value=self._identity_response(self.CANONICAL_USER_ID),
        ) as mocked:
            response = self.client.post(
                "/api/integrations/v2/driver/session/",
                {"marketplace_access_token": "marketplace-token"},
                format="json",
                HTTP_ORIGIN="https://attacker.example",
            )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(mocked.call_count, 0)

    def test_session_exchange_rejects_a_non_driver_marketplace_account(self):
        payload = json.dumps(
            {
                "user": {
                    "id": self.CANONICAL_USER_ID,
                    "role": "WHOLESALER",
                    "status": "APPROVED",
                }
            }
        ).encode("utf-8")
        identity_response = Mock()
        identity_response.read.return_value = payload
        identity_response.__enter__ = lambda self_: self_
        identity_response.__exit__ = lambda *args: False

        with patch(
            "logistics.marketplace_session_views.urlopen",
            return_value=identity_response,
        ):
            response = self.client.post(
                "/api/integrations/v2/driver/session/",
                {"marketplace_access_token": "marketplace-token"},
                format="json",
                HTTP_ORIGIN="http://localhost:3000",
            )

        self.assertEqual(response.status_code, 403, response.data)

    def test_session_exchange_without_a_credential_is_rejected(self):
        response = self.client.post(
            "/api/integrations/v2/driver/session/",
            {},
            format="json",
            HTTP_ORIGIN="http://localhost:3000",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("marketplace_access_token", response.data)



@override_settings(
    DRIVER_REQUIRED_DOCUMENT_TYPES=["identity"],
    MARKETPLACE_INTEGRATION_ENABLED=False,
)
class DriverAssistantApiTests(PrivateStorageTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.driver, _ = create_eligible_shipment_driver("assistant-driver")
        self.client = APIClient()
        self.client.force_authenticate(user=self.driver)

    def test_assistant_thread_is_created_and_answered_by_the_provider(self):
        created = self.client.post(
            "/api/assistant/conversations/", {}, format="json"
        )
        self.assertEqual(created.status_code, 201, created.data)
        conversation_id = created.data["id"]

        with patch(
            "logistics.assistant_views.get_assistant_reply",
            return_value="Your next pickup is in Market Wereda.",
        ) as mocked:
            replied = self.client.post(
                f"/api/assistant/conversations/{conversation_id}/messages/",
                {"content": "Where is my next pickup?", "language": "en"},
                format="json",
            )

        self.assertEqual(replied.status_code, 201, replied.data)
        self.assertEqual(
            replied.data["assistant_message"]["content"],
            "Your next pickup is in Market Wereda.",
        )
        self.assertEqual(mocked.call_args.args[0].pk, self.driver.pk)

        history = self.client.get(
            f"/api/assistant/conversations/{conversation_id}/messages/"
        )
        self.assertEqual(history.status_code, 200, history.data)
        self.assertEqual(len(history.data), 2)

    def test_assistant_reports_a_missing_provider_instead_of_inventing_an_answer(self):
        created = self.client.post("/api/assistant/conversations/", {}, format="json")
        conversation_id = created.data["id"]

        with patch(
            "logistics.assistant_views.get_assistant_reply",
            side_effect=AssistantProviderError("The assistant is not configured yet."),
        ):
            replied = self.client.post(
                f"/api/assistant/conversations/{conversation_id}/messages/",
                {"content": "What is my balance?"},
                format="json",
            )

        self.assertEqual(replied.status_code, 503)
        self.assertIn("not configured", replied.data["detail"])

    def test_assistant_threads_are_private_to_their_owner(self):
        created = self.client.post("/api/assistant/conversations/", {}, format="json")
        conversation_id = created.data["id"]

        stranger = create_user("assistant-stranger", LogisticsUser.Role.DRIVER)
        self.client.force_authenticate(user=stranger)
        response = self.client.get(
            f"/api/assistant/conversations/{conversation_id}/messages/"
        )

        self.assertEqual(response.status_code, 404)

    def test_assistant_tools_are_scoped_to_the_signed_in_driver(self):
        from .assistant_provider import _run_tool

        result = _run_tool("my_shipments", {}, self.driver)

        self.assertEqual(result["shipments"], [])

        shipment = Shipment.objects.create(
            buyer=create_buyer("assistant-tool-buyer"),
            seller=create_user(
                "assistant-tool-seller",
                LogisticsUser.Role.FARMER,
                external_user_id="market-assistant-tool-seller",
            ),
            external_order_reference="ASSISTANT-TOOL-ORDER-1",
            pickup_region="North",
            destination_region="North",
            product_summary="Cargo",
            status=Shipment.Status.ASSIGNED,
            assigned_driver=self.driver,
        )
        result = _run_tool("my_shipments", {}, self.driver)

        self.assertEqual(len(result["shipments"]), 1)
        self.assertEqual(result["shipments"][0]["shipment_id"], shipment.pk)

    def test_empty_assistant_message_is_rejected(self):
        created = self.client.post("/api/assistant/conversations/", {}, format="json")
        conversation_id = created.data["id"]

        response = self.client.post(
            f"/api/assistant/conversations/{conversation_id}/messages/",
            {"content": "   "},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
