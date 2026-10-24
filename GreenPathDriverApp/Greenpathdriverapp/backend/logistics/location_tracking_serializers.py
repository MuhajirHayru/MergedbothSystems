import re
from decimal import Decimal

from rest_framework import serializers


class DriverLocationUpdateSerializer(serializers.Serializer):
    latitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, min_value=-90, max_value=90
    )
    longitude = serializers.DecimalField(
        max_digits=10, decimal_places=6, min_value=-180, max_value=180
    )
    accuracy_meters = serializers.DecimalField(
        max_digits=8, decimal_places=2, min_value=Decimal("0.01")
    )
    observed_at = serializers.DateTimeField()

    def validate_observed_at(self, value):
        raw_value = self.initial_data.get("observed_at")
        if not isinstance(raw_value, str) or not re.search(
            r"(?:Z|[+-]\d{2}:\d{2})$", raw_value
        ):
            raise serializers.ValidationError(
                "Use an ISO 8601 timestamp with an explicit UTC offset."
            )
        return value


class DriverLocationResponseSerializer(serializers.Serializer):
    shipment_id = serializers.IntegerField()
    shipment_status = serializers.CharField()
    sharing_status = serializers.ChoiceField(
        choices=["starting", "sharing", "stale", "stopped"]
    )
    is_sharing = serializers.BooleanField()
    location = serializers.DictField(allow_null=True)
    last_updated_at = serializers.DateTimeField(allow_null=True)
    stale_after_seconds = serializers.IntegerField()
