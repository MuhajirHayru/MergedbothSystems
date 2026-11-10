from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler


class BusinessRuleError(APIException):
    """A rejected state transition or domain rule (HTTP 400).

    Raised instead of hand-building ``{"success": False, "error": ...}`` so the
    project-wide handler owns the response envelope. A single string detail is
    unwrapped to ``{"success": false, "error": "<message>"}``, which is exactly
    the shape the frontend's ``formatApiError`` already parses.
    """

    status_code = 400
    default_detail = "This action is not allowed."
    default_code = "business_rule"


class Conflict(APIException):
    """A request is already being processed (HTTP 409)."""

    status_code = 409
    default_detail = "This request is already being processed."
    default_code = "conflict"


class ServiceUnavailable(APIException):
    """A configured dependency (AI provider, transcription) could not answer."""

    status_code = 503
    default_detail = "This service is temporarily unavailable."
    default_code = "service_unavailable"


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        detail = response.data
        if isinstance(detail, dict) and "detail" in detail and len(detail) == 1:
            message = detail["detail"]
        else:
            message = detail
        response.data = {"success": False, "error": message}
    return response
