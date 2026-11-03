from django.urls import path

from .views import (
    SupportBulkActionView,
    SupportInboxActionView,
    SupportInboxView,
    SupportTicketListCreateView,
    SupportTicketReplyView,
)

urlpatterns = [
    path("tickets/", SupportTicketListCreateView.as_view(), name="support_tickets"),
    path("tickets/<uuid:pk>/reply/", SupportTicketReplyView.as_view(), name="support_ticket_reply"),
    path("inbox/", SupportInboxView.as_view(), name="support_inbox"),
    path("inbox/<uuid:pk>/action/", SupportInboxActionView.as_view(), name="support_inbox_action"),
    path("inbox/bulk/", SupportBulkActionView.as_view(), name="support_bulk"),
]
