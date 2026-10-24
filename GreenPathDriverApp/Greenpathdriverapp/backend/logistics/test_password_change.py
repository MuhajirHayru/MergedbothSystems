from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from .marketplace_client import MarketplaceInvalid, MarketplaceUnavailable
from .models import LogisticsUser

PASSWORD_CHANGE_URL = "/api/auth/password/change/"
MARKETPLACE_PATH = "/api/v1/auth/password/change/"


class DriverPasswordChangeTests(TestCase):
    def setUp(self):
        self.user = LogisticsUser.objects.create_user(
            username="password-driver",
            email="password-driver@example.com",
            password="OldPassword123!",
            role=LogisticsUser.Role.DRIVER,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def payload(self, **overrides):
        data = {
            "current_password": "OldPassword123!",
            "new_password": "NewPassword456!",
            "confirm_password": "NewPassword456!",
        }
        data.update(overrides)
        return data

    def test_requires_an_authenticated_account(self):
        anonymous = APIClient()
        response = anonymous.post(PASSWORD_CHANGE_URL, self.payload(), format="json")
        self.assertIn(response.status_code, (401, 403))

    def test_requires_a_linked_marketplace_credential(self):
        with patch(
            "logistics.marketplace_account_views.marketplace_credential",
            return_value=None,
        ):
            response = self.client.post(PASSWORD_CHANGE_URL, self.payload(), format="json")
        self.assertEqual(response.status_code, 403)
        self.assertIn("Marketplace", response.data["detail"])

    def test_rejects_mismatched_confirmation_without_calling_the_marketplace(self):
        with patch(
            "logistics.marketplace_account_views.marketplace_post"
        ) as marketplace_post:
            response = self.client.post(
                PASSWORD_CHANGE_URL,
                self.payload(confirm_password="Different456!"),
                format="json",
            )
        self.assertEqual(response.status_code, 400)
        marketplace_post.assert_not_called()

    def test_forwards_the_change_to_the_marketplace_endpoint(self):
        with (
            patch(
                "logistics.marketplace_account_views.marketplace_credential",
                return_value="marketplace-token",
            ),
            patch(
                "logistics.marketplace_account_views.marketplace_post"
            ) as marketplace_post,
        ):
            marketplace_post.return_value = {"success": True}
            response = self.client.post(PASSWORD_CHANGE_URL, self.payload(), format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["success"])
        marketplace_post.assert_called_once_with(
            MARKETPLACE_PATH,
            "marketplace-token",
            {
                "current_password": "OldPassword123!",
                "new_password": "NewPassword456!",
            },
            surface_validation=True,
        )

    def test_surfaces_marketplace_validation_errors(self):
        with (
            patch(
                "logistics.marketplace_account_views.marketplace_credential",
                return_value="marketplace-token",
            ),
            patch(
                "logistics.marketplace_account_views.marketplace_post",
                side_effect=MarketplaceInvalid("Current password is incorrect."),
            ),
        ):
            response = self.client.post(PASSWORD_CHANGE_URL, self.payload(), format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Current password is incorrect.")

    def test_reports_an_unreachable_marketplace(self):
        with (
            patch(
                "logistics.marketplace_account_views.marketplace_credential",
                return_value="marketplace-token",
            ),
            patch(
                "logistics.marketplace_account_views.marketplace_post",
                side_effect=MarketplaceUnavailable("Marketplace is unreachable."),
            ),
        ):
            response = self.client.post(PASSWORD_CHANGE_URL, self.payload(), format="json")

        self.assertEqual(response.status_code, 503)
