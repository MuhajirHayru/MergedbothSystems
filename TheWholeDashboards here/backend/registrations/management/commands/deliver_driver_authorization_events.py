from django.core.management.base import BaseCommand, CommandError

from registrations.driver_integration import deliver_driver_authorization_events


class Command(BaseCommand):
    help = "Deliver queued canonical driver authorization snapshots to DriverApp."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=50)

    def handle(self, *args, **options):
        if options["limit"] < 1:
            raise CommandError("--limit must be at least 1")
        result = deliver_driver_authorization_events(limit=options["limit"])
        self.stdout.write(
            "configured={configured} delivered={delivered} blocked={blocked} remaining={remaining}".format(
                **result
            )
        )
