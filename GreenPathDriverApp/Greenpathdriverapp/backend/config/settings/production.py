from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403

DEBUG = False
production_secret = env("DJANGO_SECRET_KEY", default="")  # noqa: F405
if len(production_secret) < 50 or "replace-with" in production_secret:
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be a private, randomly generated value of at least 50 characters."
    )
SECRET_KEY = production_secret
if not env.list("DJANGO_ALLOWED_HOSTS", default=[]):  # noqa: F405
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must be set in production.")

CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])  # noqa: F405
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)  # noqa: F405
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=3600)  # noqa: F405