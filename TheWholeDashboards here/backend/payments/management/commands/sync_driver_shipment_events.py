from django.core.management.base import BaseCommand

from payments.shipment_feed import sync_driver_shipment_events


class Command(BaseCommand):
    help = "Poll and persist a bounded page of DriverApp shipment events."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=50)

    def handle(self, *args, **options):
        result = sync_driver_shipment_events(limit=options["limit"])
        self.stdout.write(
            self.style.SUCCESS(
                f"Processed {result['processed']} shipment event(s); "
                f"cursor={result['cursor']}; has_more={result['has_more']}."
            )
        )
