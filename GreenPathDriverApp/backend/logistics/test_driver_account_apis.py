from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from .marketplace_client import MarketplaceInvalid, MarketplaceUnauthenticated
from .models import DriverProfile, LogisticsUser


class DriverAccountApiTestCase(TestCase):
    def setUp(self):
        self.user = LogisticsUser.objects.create_user(
            username="profile-driver",
            email="profile-driver@example.com",
            password="OldPassword123!",
            role=LogisticsUser.Role.DRIVER,
            first_name="Aster",
            last_name="Bekele",
        )
        self.profile, _ = DriverProfile.objects.get_or_create(
            user=self.user, defaults={"phone_number": "+251900000001"}
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def marketplace_profile(self):
        return {
            "id": "2c22f5ef-8a3b-4a5e-9d0b-7d1a4c9f6e21",
            "full_name": "Aster Bekele",
            "email": "profile-driver@example.com",
            "phone": "+251900000001",
            "location": "Addis Ababa",
            "profile_photo": "http://marketplace.test/media/profiles/aster.jpg",
            "role": "DRIVER",
            "status": "APPROVED",
        }


class DriverProfileApiTests(DriverAccountApiTestCase):
    def test_returns_linked_canonical_profile(self):
        with (
            patch(
                "logistics.marketplace_profile_views.marketplace_credential",
                return_value="token",
            ),
            patch(
                "logistics.marketplace_profile_views.marketplace_get",
                return_value={"user": self.marketplace_profile()},
            ) as marketplace_get,
        ):
            response = self.client.get("/api/auth/profile/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["linked"])
        self.assertEqual(response.data["profile"]["phone"], "+251900000001")
        self.assertTrue(response.data["editable"]["photo"])
        marketplace_get.assert_called_once_with("/api/v1/auth/me/", "token")

    def test_falls_back_to_local_profile_when_marketplace_is_unlinked(self):
        with patch(
            "logistics.marketplace_profile_views.marketplace_credential",
            return_value=None,
        ):
            response = self.client.get("/api/auth/profile/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["linked"])
        self.assertEqual(response.data["profile"]["full_name"], "Aster Bekele")
        self.assertFalse(response.data["editable"]["full_name"])

    def test_updates_name_and_phone_through_the_marketplace(self):
        updated = {**self.marketplace_profile(), "full_name": "Aster T. Bekele", "phone": "+251911111111"}
        with (
            patch(
                "logistics.marketplace_profile_views.marketplace_credential",
                return_value="token",
            ),
            patch(
                "logistics.marketplace_profile_views.marketplace_patch",
                return_value={"success": True, "user": updated},
            ) as marketplace_patch,
        ):
            response = self.client.patch(
                "/api/auth/profile/",
                {
                    "full_name": "Aster T. Bekele",
                    "phone": "+251911111111",
                    "role": "SUPER_ADMIN",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.data)
        marketplace_patch.assert_called_once_with(
            "/api/v1/auth/profile/",
            "token",
            {"full_name": "Aster T. Bekele", "phone": "+251911111111"},
        )
        self.user.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.user.first_name, "Aster")
        self.assertEqual(self.user.last_name, "T. Bekele")
        self.assertEqual(self.profile.phone_number, "+251911111111")

    def test_surfaces_marketplace_field_errors(self):
        with (
            patch(
                "logistics.marketplace_profile_views.marketplace_credential",
                return_value="token",
            ),
            patch(
                "logistics.marketplace_profile_views.marketplace_patch",
                side_effect=MarketplaceInvalid("This field is not editable in your profile."),
            ),
        ):
            response = self.client.patch(
                "/api/auth/profile/", {"full_name": "New Name"}, format="json"
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("not editable", response.data["detail"])

    def test_rejects_empty_updates(self):
        response = self.client.patch("/api/auth/profile/", {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rejects_non_driver_accounts(self):
        wholesaler = LogisticsUser.objects.create_user(
            username="wholesaler-account",
            password="OldPassword123!",
            role=LogisticsUser.Role.WHOLESALER,
        )
        self.client.force_authenticate(user=wholesaler)
        response = self.client.get("/api/auth/profile/")
        self.assertEqual(response.status_code, 403)


class DriverProfilePhotoApiTests(DriverAccountApiTestCase):
    def test_rejects_unsupported_file_types(self):
        upload = SimpleUploadedFile("avatar.gif", b"GIF89a", content_type="image/gif")
        response = self.client.post(
            "/api/auth/profile/photo/", {"profile_photo": upload}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("JPEG", response.data["detail"])

    def test_rejects_oversized_images(self):
        upload = SimpleUploadedFile(
            "avatar.png",
            b"x" * (5 * 1024 * 1024 + 1),
            content_type="image/png",
        )
        response = self.client.post(
            "/api/auth/profile/photo/", {"profile_photo": upload}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("5 MB", response.data["detail"])

    def test_forwards_a_valid_image_to_the_marketplace(self):
        upload = SimpleUploadedFile(
            "avatar.png", b"\x89PNG\r\n\x1a\nfake", content_type="image/png"
        )
        with (
            patch(
                "logistics.marketplace_profile_views.marketplace_credential",
                return_value="token",
            ),
            patch(
                "logistics.marketplace_profile_views.marketplace_upload",
                return_value={"success": True, "user": self.marketplace_profile()},
            ) as marketplace_upload,
        ):
            response = self.client.post(
                "/api/auth/profile/photo/",
                {"profile_photo": upload},
                format="multipart",
            )

        self.assertEqual(response.status_code, 200, response.data)
        marketplace_upload.assert_called_once()
        args, kwargs = marketplace_upload.call_args
        self.assertEqual(args[0], "/api/v1/auth/profile/photo/")
        self.assertEqual(args[1], "token")
        self.assertEqual(kwargs["field_name"], "profile_photo")
        self.assertEqual(kwargs["content_type"], "image/png")

    def test_removes_the_marketplace_picture(self):
        with (
            patch(
                "logistics.marketplace_profile_views.marketplace_credential",
                return_value="token",
            ),
            patch(
                "logistics.marketplace_profile_views.marketplace_delete",
                return_value=None,
            ) as marketplace_delete,
        ):
            response = self.client.delete("/api/auth/profile/photo/")

        self.assertEqual(response.status_code, 200, response.data)
        marketplace_delete.assert_called_once_with(
            "/api/v1/auth/profile/photo/", "token"
        )


class DriverBankAccountApiTests(DriverAccountApiTestCase):
    def test_lists_masked_accounts_from_the_marketplace(self):
        accounts = {
            "count": 1,
            "results": [
                {
                    "id": "b7bfe4ea-2a3f-4a2f-b753-1f6f0f8a2a11",
                    "bank_name": "Commercial Bank of Ethiopia",
                    "masked_account_number": "****0400",
                    "status": "NOT_VERIFIED",
                    "is_default": True,
                }
            ],
        }
        with (
            patch(
                "logistics.marketplace_bank_views.marketplace_credential",
                return_value="token",
            ),
            patch(
                "logistics.marketplace_bank_views.marketplace_get",
                return_value=accounts,
            ),
        ):
            response = self.client.get("/api/wallet/bank-accounts/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["results"][0]["masked_account_number"], "****0400")
        self.assertNotIn("account_number", response.data["results"][0])

    def test_creates_only_allowed_account_fields(self):
        with (
            patch(
                "logistics.marketplace_bank_views.marketplace_credential",
                return_value="token",
            ),
            patch(
                "logistics.marketplace_bank_views.marketplace_post",
                return_value={
                    "id": "b7bfe4ea-2a3f-4a2f-b753-1f6f0f8a2a11",
                    "masked_account_number": "****0400",
                },
            ) as marketplace_post,
        ):
            response = self.client.post(
                "/api/wallet/bank-accounts/",
                {
                    "bank": "6c70c70d-6a4c-4d72-8a6f-2ec1a1f6f5a2",
                    "account_holder_name": "Aster Bekele",
                    "account_number": "100200300400",
                    "confirm_account_number": "100200300400",
                    "is_default": True,
                    "user": "not-allowed",
                    "status": "NOT_VERIFIED",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 201, response.data)
        args, kwargs = marketplace_post.call_args
        self.assertEqual(args[0], "/api/v1/wallet/bank-accounts/")
        payload = args[2]
        self.assertNotIn("user", payload)
        self.assertNotIn("status", payload)
        self.assertTrue(payload["is_default"])
        self.assertTrue(kwargs["surface_validation"])

    def test_bank_endpoints_require_a_driver_account(self):
        wholesaler = LogisticsUser.objects.create_user(
            username="bank-wholesaler",
            password="OldPassword123!",
            role=LogisticsUser.Role.WHOLESALER,
        )
        self.client.force_authenticate(user=wholesaler)
        self.assertEqual(self.client.get("/api/wallet/bank-accounts/").status_code, 403)
