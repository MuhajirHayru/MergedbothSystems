from django.core.management.base import BaseCommand, CommandError

from payments.integration_outbox import deliver_pending_events


class Command(BaseCommand):
    help = "Deliver a bounded batch of durable marketplace integration events."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=50)

    def handle(self, *args, **options):
        limit = options["limit"]
        if limit < 1 or limit > 500:
            raise CommandError("--limit must be between 1 and 500.")
        delivered = deliver_pending_events(limit=limit)
        self.stdout.write(
            self.style.SUCCESS(f"Delivered {delivered} integration event(s).")
        )
