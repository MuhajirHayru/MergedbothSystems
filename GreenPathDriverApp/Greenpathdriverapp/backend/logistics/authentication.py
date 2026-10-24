from rest_framework.authentication import SessionAuthentication
from drf_spectacular.extensions import OpenApiAuthenticationExtension


class SessionAuthenticationWith401(SessionAuthentication):
    def authenticate_header(self, request):
        return "Session"


class SessionCookieScheme(OpenApiAuthenticationExtension):
    target_class = "logistics.authentication.SessionAuthenticationWith401"
    name = "sessionCookie"

    def get_security_definition(self, auto_schema):
        return {"type": "apiKey", "in": "cookie", "name": "sessionid"}