import logging

import pytest
from django.http import HttpResponse
from django.test import RequestFactory

from greenpath.performance import PerformanceDiagnosticsMiddleware
from users.models import User

pytestmark = pytest.mark.django_db


def test_performance_middleware_logs_duration_and_query_count(caplog):
    request = RequestFactory().get("/api/v1/auth/me/")

    def handle_request(_request):
        User.objects.count()
        return HttpResponse(status=200)

    middleware = PerformanceDiagnosticsMiddleware(handle_request)
    with caplog.at_level(logging.INFO, logger="greenpath.performance"):
        response = middleware(request)

    assert response.status_code == 200
    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "method=GET" in message
    assert "status=200" in message
    assert "database_query_count=1" in message
    assert "database_ms=" in message
    assert "SELECT" not in message
