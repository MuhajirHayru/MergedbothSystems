from django.core.management.base import BaseCommand

from logistics.services import expire_driver_applications


class Command(BaseCommand):
    help = "Expire approved driver applications whose license or current documents have expired."

    def handle(self, *args, **options):
        count = expire_driver_applications()
        self.stdout.write(self.style.SUCCESS(f"Expired {count} driver application(s)."))