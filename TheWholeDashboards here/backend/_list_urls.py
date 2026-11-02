import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "greenpath.settings")
django.setup()

from django.urls import get_resolver

def walk(pats, prefix=""):
    for p in pats:
        if hasattr(p, "url_patterns"):
            walk(p.url_patterns, prefix + str(p.pattern))
        else:
            print(prefix + str(p.pattern))

walk(get_resolver().url_patterns)
