import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0020_financialordersnapshot_service_fee_amount'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='FinancialRefundRequest',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=14)),
                ('reason', models.TextField()),
                ('status', models.CharField(choices=[('PENDING', 'Pending approval'), ('APPROVED', 'Approved'), ('REJECTED', 'Rejected'), ('EXECUTING', 'Executing'), ('PAID', 'Paid'), ('FAILED', 'Failed'), ('RECONCILED', 'Reconciled')], default='PENDING', max_length=16)),
                ('payment_reference', models.CharField(blank=True, default='', max_length=100)),
                ('approval_reference', models.CharField(blank=True, default='', max_length=100)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('paid_at', models.DateTimeField(blank=True, null=True)),
                ('journal_entry', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='financial_refund', to='payments.financialjournalentry')),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='financial_refunds', to='payments.order')),
                ('reviewed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='financial_refunds_reviewed', to=settings.AUTH_USER_MODEL)),
                ('submitted_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='financial_refunds_submitted', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'financial_refund_requests',
                'ordering': ['-created_at'],
                'constraints': [models.CheckConstraint(condition=models.Q(('amount__gt', 0)), name='financial_refund_positive_amount')],
            },
        ),
    ]
