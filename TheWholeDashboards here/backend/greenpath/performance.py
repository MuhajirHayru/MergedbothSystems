import logging
from time import perf_counter

from django.db import connection

logger = logging.getLogger(__name__)


class PerformanceDiagnosticsMiddleware:
    """Opt-in request and default-database timing; SQL and parameters are omitted."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started_at = perf_counter()
        query_count = 0
        database_ms = 0.0
        status_code = 500

        def record_query(execute, sql, params, many, context):
            nonlocal query_count, database_ms
            query_started_at = perf_counter()
            try:
                return execute(sql, params, many, context)
            finally:
                query_count += 1
                database_ms += (perf_counter() - query_started_at) * 1000

        try:
            with connection.execute_wrapper(record_query):
                response = self.get_response(request)
            status_code = response.status_code
            return response
        finally:
            logger.info(
                "request_performance method=%s endpoint=%s status=%s duration_ms=%.2f database_query_count=%s database_ms=%.2f",
                request.method,
                getattr(
                    getattr(request, "resolver_match", None), "route", request.path
                ),
                status_code,
                (perf_counter() - started_at) * 1000,
                query_count,
                database_ms,
            )
