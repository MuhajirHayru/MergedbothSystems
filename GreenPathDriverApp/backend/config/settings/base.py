from pathlib import Path

import environ


BASE_DIR = Path(__file__).resolve().parents[2]
env = environ.Env()
env.read_env(BASE_DIR.parent / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="development-only-change-me")
DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "logistics",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
    )
}

AUTH_USER_MODEL = "logistics.LogisticsUser"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Addis_Ababa"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
PRIVATE_DOCUMENT_ROOT = Path(
    env("PRIVATE_DOCUMENT_ROOT", default=str(BASE_DIR / "private_documents"))
)
PRIVATE_DOCUMENT_STORAGE_BACKEND = env(
    "PRIVATE_DOCUMENT_STORAGE_BACKEND",
    default="django.core.files.storage.FileSystemStorage",
)
PRIVATE_DOCUMENT_STORAGE_OPTIONS = env.json(
    "PRIVATE_DOCUMENT_STORAGE_OPTIONS", default={}
)
if (
    PRIVATE_DOCUMENT_STORAGE_BACKEND == "django.core.files.storage.FileSystemStorage"
    and "location" not in PRIVATE_DOCUMENT_STORAGE_OPTIONS
):
    PRIVATE_DOCUMENT_STORAGE_OPTIONS["location"] = str(PRIVATE_DOCUMENT_ROOT)
DRIVER_DOCUMENT_MAX_BYTES = env.int("DRIVER_DOCUMENT_MAX_BYTES", default=10 * 1024 * 1024)
SHIPMENT_EVIDENCE_MAX_BYTES = env.int(
    "SHIPMENT_EVIDENCE_MAX_BYTES", default=10 * 1024 * 1024
)
SHIPMENT_REQUIRE_PICKUP_EVIDENCE = env.bool(
    "SHIPMENT_REQUIRE_PICKUP_EVIDENCE", default=True
)
SHIPMENT_REQUIRE_DELIVERY_EVIDENCE = env.bool(
    "SHIPMENT_REQUIRE_DELIVERY_EVIDENCE", default=True
)
DRIVER_LOCATION_MAX_ACCURACY_METERS = env.int(
    "DRIVER_LOCATION_MAX_ACCURACY_METERS", default=1000
)
DRIVER_LOCATION_MAX_AGE_SECONDS = env.int(
    "DRIVER_LOCATION_MAX_AGE_SECONDS", default=120
)
DRIVER_LOCATION_FUTURE_SKEW_SECONDS = env.int(
    "DRIVER_LOCATION_FUTURE_SKEW_SECONDS", default=30
)
DRIVER_LOCATION_SESSION_TIMEOUT_SECONDS = env.int(
    "DRIVER_LOCATION_SESSION_TIMEOUT_SECONDS", default=120
)
DRIVER_LOCATION_STALE_AFTER_SECONDS = env.int(
    "DRIVER_LOCATION_STALE_AFTER_SECONDS", default=90
)
DRIVER_LOCATION_MAX_PAYLOAD_BYTES = env.int(
    "DRIVER_LOCATION_MAX_PAYLOAD_BYTES", default=2048
)
MARKETPLACE_INTEGRATION_ENABLED = env.bool(
    "MARKETPLACE_INTEGRATION_ENABLED", default=False
)
MARKETPLACE_INTEGRATION_SECRET = env(
    "MARKETPLACE_INTEGRATION_SECRET", default=""
)
MARKETPLACE_INTEGRATION_MAX_BYTES = env.int(
    "MARKETPLACE_INTEGRATION_MAX_BYTES", default=256 * 1024
)
MARKETPLACE_INTEGRATION_MAX_SKEW_SECONDS = env.int(
    "MARKETPLACE_INTEGRATION_MAX_SKEW_SECONDS", default=300
)
DRIVER_DOCUMENT_TYPES = env.list(
    "DRIVER_DOCUMENT_TYPES",
    default=["identity", "driving_license", "vehicle_registration"],
)
DRIVER_REQUIRED_DOCUMENT_TYPES = env.list(
    "DRIVER_REQUIRED_DOCUMENT_TYPES",
    default=["identity", "driving_license", "vehicle_registration"],
)
DRIVER_REQUIRED_APPLICATION_FIELDS = env.list(
    "DRIVER_REQUIRED_APPLICATION_FIELDS",
    default=[
        "legal_full_name",
        "license_number",
        "license_expiry",
        "vehicle_type",
        "vehicle_registration",
        "cargo_capacity_kg",
    ],
)
DRIVER_EXPIRY_POLICY = env("DRIVER_EXPIRY_POLICY", default="expire")
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
    },
    "private_documents": {
        "BACKEND": PRIVATE_DOCUMENT_STORAGE_BACKEND,
        "OPTIONS": PRIVATE_DOCUMENT_STORAGE_OPTIONS,
    },
}

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = env.int("SESSION_COOKIE_AGE", default=1800)
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SESSION_SAVE_EVERY_REQUEST = True
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
EMAIL_BACKEND = env(
    "EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend"
)
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="GreenPath <noreply@example.invalid>")
FRONTEND_BASE_URL = env("FRONTEND_BASE_URL", default="http://localhost:3000")
GREENPATH_MARKETPLACE_API_BASE_URL = env(
    "GREENPATH_MARKETPLACE_API_BASE_URL", default=""
).rstrip("/")
MARKETPLACE_LOGIN_ALLOWED_ORIGINS = env.list(
    "MARKETPLACE_LOGIN_ALLOWED_ORIGINS", default=[FRONTEND_BASE_URL]
)
GROQ_API_KEY = env("GROQ_API_KEY", default="")
GROQ_CHAT_MODEL = env("GROQ_CHAT_MODEL", default="")
GROQ_TRANSCRIPTION_MODEL = env("GROQ_TRANSCRIPTION_MODEL", default="whisper-large-v3-turbo")
GROQ_TIMEOUT_SECONDS = env.int("GROQ_TIMEOUT_SECONDS", default=30)
GROQ_MAX_AUDIO_BYTES = env.int("GROQ_MAX_AUDIO_BYTES", default=10 * 1024 * 1024)
PASSWORD_RESET_DEBUG_DELIVERY = env.bool("PASSWORD_RESET_DEBUG_DELIVERY", default=False)
REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "logistics.authentication.SessionAuthenticationWith401",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "auth_login": "5/minute",
        "auth_register": "3/hour",
        "auth_password_reset": "3/hour",
        "auth_password_reset_confirm": "5/hour",
        "auth_password_change": "5/hour",
        "driver_document_upload": "10/hour",
        "marketplace_integration": "60/minute",
        "driver_location_update": "30/minute",
        "driver_location_session": "12/minute",
        "shipment_location_read": "120/minute",
        "assistant_chat": "20/minute",
        "assistant_transcription": "10/minute",
    },
}
PASSWORD_RESET_TIMEOUT = 3600
SPECTACULAR_SETTINGS = {
    "TITLE": "GreenPathDriverApp API",
    "DESCRIPTION": "Independent agricultural logistics API foundation.",
    "VERSION": "0.1.0",
}
