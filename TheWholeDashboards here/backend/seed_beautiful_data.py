#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Comprehensive seed data script for GreenPath Systems.
Populates database with beautiful, realistic data for all user roles and features.
PRESERVES existing data - only ADDS new records.
"""
import os
import sys
import django
from decimal import Decimal
from datetime import datetime, timedelta
from django.utils import timezone
from django.core.files.base import ContentFile
import random

# Fix Windows console encoding
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "greenpath.settings")
django.setup()

from users.models import User, AccountStatus, Role
from products.models import Product, ProductStatus, ProductType
from payments.models import (
    Order, Wallet, WalletTransaction, WalletFundingRequest, 
    WalletPayoutRequest, PayoutBank, BankAccount, Review,
    BusinessAgreement, OrderShipmentDetails, MarketplaceDeliveryFeeAgreement,
    PaymentMethod, FundingStatus, PayoutStatus, OrderStatus, OrderPaymentStatus
)
from registrations.models import (
    AdministrativeLocation, AgriculturalProductType, ProductCatalogCategory,
    ProductVariety, UserRegistration, RegistrationProductSelection, LocationLevel,
    RegistrationStatus
)
from chat.models import ChatChannel, Message
from notifications.models import Notification, NotificationType
import django.db.models

print("=" * 80)
print("GREENPATH SYSTEMS - BEAUTIFUL DATA SEEDER")
print("=" * 80)
print(f"Started at: {timezone.now()}")
print()

# Ethiopian regions for realistic data
REGIONS = [
    "Addis Ababa", "Oromia", "Amhara", "Tigray", "SNNPR",
    "Somali", "Afar", "Benishangul-Gumuz", "Gambela", "Harari"
]

ZONES = {
    "Addis Ababa": ["Bole", "Kirkos", "Yeka", "Arada", "Lideta"],
    "Oromia": ["East Shewa", "West Shewa", "Arsi", "Bale", "Jimma"],
    "Amhara": ["North Gondar", "South Gondar", "North Wollo", "South Wollo", "East Gojjam"],
}

# Product data with Ethiopian agricultural products
VEGETABLES = [
    ("Tomato", 25, 45), ("Potato", 15, 30), ("Onion", 18, 35),
    ("Cabbage", 12, 25), ("Carrot", 20, 40), ("Beetroot", 18, 35),
    ("Green Pepper", 30, 60), ("Red Pepper", 35, 65), ("Lettuce", 25, 50)
]

FRUITS = [
    ("Banana", 20, 40), ("Mango", 35, 70), ("Papaya", 25, 50),
    ("Avocado", 45, 90), ("Orange", 30, 60), ("Lemon", 28, 55),
    ("Watermelon", 15, 30), ("Pineapple", 40, 80)
]

GRAINS = [
    ("Teff", 80, 150), ("Wheat", 60, 120), ("Barley", 55, 110),
    ("Maize", 45, 90), ("Sorghum", 50, 100), ("Millet", 48, 95)
]

PULSES = [
    ("Chickpea", 70, 140), ("Lentil", 75, 150), ("Fava Bean", 65, 130),
    ("Field Pea", 60, 120), ("Haricot Bean", 68, 135)
]

def create_locations():
    """Create Ethiopian administrative locations."""
    print("\n[LOCATIONS] Creating administrative locations...")
    locations_created = 0
    
    for region_name in REGIONS:
        region, created = AdministrativeLocation.objects.get_or_create(
            name=region_name,
            level="REGION",
            defaults={"active": True, "source_id": f"REGION_{region_name.upper().replace(' ', '_')}"}
        )
        if created:
            locations_created += 1
            print(f"  [+] Created region: {region_name}")
        
        # Create zones for regions with defined zones
        if region_name in ZONES:
            for zone_name in ZONES[region_name]:
                zone, created = AdministrativeLocation.objects.get_or_create(
                    name=zone_name,
                    parent=region,
                    level="ZONE",
                    defaults={"active": True, "source_id": f"ZONE_{zone_name.upper().replace(' ', '_')}"}
                )
                if created:
                    locations_created += 1
    
    print(f"  [OK] Locations created: {locations_created}")
    return AdministrativeLocation.objects.filter(active=True)

def create_product_catalog():
    """Create comprehensive product catalog."""
    print("\n[CATALOG] Creating product catalog...")
    
    # Categories
    categories_data = [
        ("Vegetables", "Fresh vegetables", "ðŸ¥¬"),
        ("Fruits", "Fresh fruits", "ðŸŽ"),
        ("Grains", "Cereals and grains", "ðŸŒ¾"),
        ("Pulses", "Legumes and pulses", "ðŸ«˜"),
        ("Spices", "Spices and herbs", "ðŸŒ¶ï¸"),
        ("Root Crops", "Root vegetables", "ðŸ¥”"),
    ]
    
    for name, desc, _ in categories_data:
        ProductCatalogCategory.objects.get_or_create(
            slug=name.lower().replace(" ", "-"),
            defaults={
                "name_en": name,
                "description": desc,
                "active": True,
                "registration_enabled": True
            }
        )
    
    # Agricultural products
    products_data = [
        ("Vegetables", VEGETABLES),
        ("Fruits", FRUITS),
        ("Grains", GRAINS),
        ("Pulses", PULSES),
    ]
    
    products_created = 0
    for category_name, products in products_data:
        try:
            category = ProductCatalogCategory.objects.get(slug=category_name.lower().replace(" ", "-"))
        except ProductCatalogCategory.DoesNotExist:
            continue
            
        for product_name, _, _ in products:
            product, created = AgriculturalProductType.objects.get_or_create(
                category=category,
                name=product_name,
                defaults={
                    "code": f"{category.slug[:3]}_{product_name.upper().replace(' ', '_')}",
                    "active": True
                }
            )
            if created:
                products_created += 1
    
    print(f"  âœ… Products created: {products_created}")
    return AgriculturalProductType.objects.filter(active=True)

def create_users_and_registrations(locations):
    """Create diverse users across all roles."""
    print("\nðŸ‘¥ Creating users and registrations...")
    users_created = 0
    
    # Ethiopian names
    first_names = ["Abebe", "Tigist", "Kebede", "Almaz", "Girma", "Selam", "Tadesse", "Meron", "Bekele", "Hana"]
    last_names = ["Tesfaye", "Kebede", "Hailu", "Alemu", "Desta", "Girma", "Tadesse", "Bekele", "Mulugeta", "Getachew"]
    
    roles_to_create = [
        ("FARMER", 15),
        ("WHOLESALER", 10),
        ("RETAILER", 12),
        ("DRIVER", 8),
        ("USER_ADMIN", 3),
        ("FINANCIAL_MANAGER", 2),
        ("SUPER_ADMIN", 1),
    ]
    
    created_users = []
    
    for role, count in roles_to_create:
        for i in range(count):
            username = f"{role.lower()}{i+1:02d}"
            email = f"{username}@greenpath.et"
            
            # Skip if email exists
            if User.objects.filter(email=email).exists():
                continue
            
            first_name = random.choice(first_names)
            last_name = random.choice(last_names)
            
            if role == "SUPER_ADMIN":
                user = User.objects.create_superuser(
                    email=email,
                    password="Green@2024",
                    full_name=f"{first_name} {last_name}",
                    role=role,
                    phone=f"+2519{random.randint(10000000, 99999999)}",
                    location="Addis Ababa",
                    privacy_policy_accepted=True
                )
            else:
                user = User.objects.create_user(
                    email=email,
                    password="Green@2024",
                    full_name=f"{first_name} {last_name}",
                    role=role,
                    status=AccountStatus.APPROVED,
                    phone=f"+2519{random.randint(10000000, 99999999)}",
                    location=random.choice(locations).name if locations else "Addis Ababa",
                    latitude=Decimal(str(random.uniform(8.5, 9.5))),
                    longitude=Decimal(str(random.uniform(38.5, 39.5))),
                    privacy_policy_accepted=True
                )
            
            # Create registration
            location = random.choice(locations) if locations else None
            registration = UserRegistration.objects.create(
                user=user,
                date_of_birth=datetime(1985 + i, random.randint(1, 12), random.randint(1, 28)).date(),
                sex=random.choice(["M", "F"]),
                business_name=f"{first_name}'s Business",
                location=location,
                status=RegistrationStatus.APPROVED
            )
            
            # Create wallet
            Wallet.objects.get_or_create(user=user)
            
            created_users.append(user)
            users_created += 1
            print(f"  [+] Created {role}: {email}")
    
    print(f"  âœ… Users created: {users_created}")
    return created_users

def create_products_and_listings(users, product_types):
    """Create product listings for farmers and wholesalers."""
    print("\nðŸ“¦ Creating product listings...")
    listings_created = 0
    
    farmers = [u for u in users if u.role == "FARMER"]
    wholesalers = [u for u in users if u.role == "WHOLESALER"]
    
    # Farmer listings
    for farmer in farmers:
        num_products = random.randint(3, 8)
        for _ in range(num_products):
            product_type = random.choice(product_types)
            category_name = product_type.category.name_en if product_type.category else "Other"
            
            # Get price range based on category
            price_data = None
            if category_name == "Vegetables":
                price_data = next((p for p in VEGETABLES if p[0] == product_type.name), None)
            elif category_name == "Fruits":
                price_data = next((p for p in FRUITS if p[0] == product_type.name), None)
            elif category_name == "Grains":
                price_data = next((p for p in GRAINS if p[0] == product_type.name), None)
            elif category_name == "Pulses":
                price_data = next((p for p in PULSES if p[0] == product_type.name), None)
            
            if price_data:
                _, min_price, max_price = price_data
                price = Decimal(str(random.uniform(min_price, max_price)))
            else:
                price = Decimal(str(random.uniform(20, 100)))
            
            Product.objects.create(
                title=f"Fresh {product_type.name}",
                description=f"High quality {product_type.name} from {farmer.location}",
                category=category_name,
                catalog_product=product_type,
                quantity=Decimal(str(random.randint(50, 500))),
                unit_of_measure="kg",
                price_per_unit=price,
                status=ProductStatus.ACTIVE,
                product_type=ProductType.FARMER_LISTING,
                owner=farmer
            )
            listings_created += 1
    
    # Wholesaler listings
    for wholesaler in wholesalers:
        num_products = random.randint(2, 6)
        for _ in range(num_products):
            product_type = random.choice(product_types)
            category_name = product_type.category.name_en if product_type.category else "Other"
            
            Product.objects.create(
                title=f"Wholesale {product_type.name}",
                description=f"Bulk {product_type.name} available for retailers",
                category=category_name,
                catalog_product=product_type,
                quantity=Decimal(str(random.randint(100, 1000))),
                unit_of_measure="quintal",
                price_per_unit=Decimal(str(random.uniform(30, 150))),
                status=ProductStatus.ACTIVE,
                product_type=ProductType.WHOLESALER_LISTING,
                owner=wholesaler
            )
            listings_created += 1
    
    print(f"  âœ… Listings created: {listings_created}")

def create_orders_and_transactions(users):
    """Create realistic orders with transactions."""
    print("\nðŸ’° Creating orders and transactions...")
    
    farmers = [u for u in users if u.role == "FARMER"]
    wholesalers = [u for u in users if u.role == "WHOLESALER"]
    retailers = [u for u in users if u.role == "RETAILER"]
    
    orders_created = 0
    transactions_created = 0
    
    # Wholesaler orders from farmers
    for wholesaler in wholesalers[:7]:  # Not all wholesalers have orders
        num_orders = random.randint(3, 8)
        for _ in range(num_orders):
            farmer = random.choice(farmers)
            farmer_products = Product.objects.filter(
                owner=farmer,
                product_type=ProductType.FARMER_LISTING,
                status=ProductStatus.ACTIVE
            )
            
            if not farmer_products.exists():
                continue
            
            product = random.choice(farmer_products)
            quantity = Decimal(str(random.randint(10, 100)))
            total = quantity * product.price_per_unit
            
            # Create order with various statuses
            status_choices = [
                OrderStatus.COMPLETED,
                OrderStatus.DELIVERED,
                OrderStatus.SHIPPED,
                OrderStatus.CONFIRMED,
                OrderStatus.ACCEPTED,
            ]
            
            payment_status_choices = [
                OrderPaymentStatus.RELEASED,
                OrderPaymentStatus.HELD,
                OrderPaymentStatus.RESERVED,
            ]
            
            status = random.choice(status_choices)
            payment_status = random.choice(payment_status_choices)
            
            # Create order
            order = Order.objects.create(
                wholesaler=wholesaler,
                farmer=farmer,
                product=product,
                quantity=quantity,
                total_amount=total,
                status=status,
                payment_status=payment_status,
                delivered_at=timezone.now() - timedelta(days=random.randint(1, 30)) if status == Order.Status.COMPLETED else None
            )
            orders_created += 1
            
            # Create wallet transactions
            buyer_wallet = Wallet.objects.get(user=wholesaler)
            seller_wallet = Wallet.objects.get(user=farmer)
            
            if payment_status in [Order.PaymentStatus.HELD, Order.PaymentStatus.RESERVED]:
                # Reserve buyer funds
                WalletTransaction.objects.create(
                    wallet=buyer_wallet,
                    transaction_type=WalletTransaction.TransactionType.ORDER_RESERVATION,
                    amount=total,
                    running_balance=buyer_wallet.available_balance,
                    related_order=order,
                    description=f"Order payment for {product.title}"
                )
                buyer_wallet.held_balance += total
                buyer_wallet.save()
                transactions_created += 1
            
            if payment_status == Order.PaymentStatus.RELEASED:
                # Release to seller
                WalletTransaction.objects.create(
                    wallet=seller_wallet,
                    transaction_type=WalletTransaction.TransactionType.ESCROW_RELEASE,
                    amount=total,
                    running_balance=seller_wallet.available_balance + total,
                    related_order=order,
                    description=f"Payment received for {product.title}"
                )
                seller_wallet.available_balance += total
                seller_wallet.save()
                transactions_created += 1
            
            # Create business agreement
            BusinessAgreement.objects.create(
                order=order,
                terms=f"Supply {quantity} {product.unit_of_measure} of {product.title}",
                status=BusinessAgreement.Status.COMPLETED if status == Order.Status.COMPLETED else BusinessAgreement.Status.ACTIVE
            )
    
    # Retailer orders from wholesalers
    for retailer in retailers[:8]:
        num_orders = random.randint(2, 6)
        for _ in range(num_orders):
            wholesaler = random.choice(wholesalers)
            wholesaler_products = Product.objects.filter(
                owner=wholesaler,
                product_type=ProductType.WHOLESALER_LISTING,
                status=ProductStatus.ACTIVE
            )
            
            if not wholesaler_products.exists():
                continue
            
            product = random.choice(wholesaler_products)
            quantity = Decimal(str(random.randint(5, 50)))
            total = quantity * product.price_per_unit
            
            status = random.choice([
                Order.Status.COMPLETED,
                Order.Status.DELIVERED,
                Order.Status.SHIPPED,
                Order.Status.ACCEPTED,
            ])
            
            order = Order.objects.create(
                retailer=retailer,
                wholesaler=wholesaler,
                product=product,
                quantity=quantity,
                total_amount=total,
                status=status,
                payment_status=random.choice([Order.PaymentStatus.RELEASED, Order.PaymentStatus.HELD]),
                delivered_at=timezone.now() - timedelta(days=random.randint(1, 20)) if status == Order.Status.COMPLETED else None
            )
            orders_created += 1
    
    print(f"  âœ… Orders created: {orders_created}")
    print(f"  âœ… Transactions created: {transactions_created}")

def fund_wallets(users):
    """Add funding to user wallets."""
    print("\nðŸ’µ Funding user wallets...")
    
    farmers = [u for u in users if u.role == "FARMER"]
    wholesalers = [u for u in users if u.role == "WHOLESALER"]
    retailers = [u for u in users if u.role == "RETAILER"]
    financial_managers = [u for u in users if u.role == "FINANCIAL_MANAGER"]
    
    funded = 0
    
    # Fund wholesalers and retailers for purchasing
    for user in wholesalers + retailers:
        wallet = Wallet.objects.get(user=user)
        amount = Decimal(str(random.randint(5000, 50000)))
        
        # Create funding request
        funding = WalletFundingRequest.objects.create(
            wallet=wallet,
            amount=amount,
            payment_method=PaymentMethod.MANUAL,
            status=FundingStatus.APPROVED,
            payment_reference=f"FUND-{user.username}-{random.randint(1000, 9999)}",
            verified_by=random.choice(financial_managers) if financial_managers else None
        )
        
        # Add funds to wallet
        WalletTransaction.objects.create(
            wallet=wallet,
            transaction_type=WalletTransaction.TransactionType.FUNDING,
            amount=amount,
            running_balance=wallet.available_balance + amount,
            description=f"Wallet funding via {funding.payment_method}"
        )
        wallet.available_balance += amount
        wallet.save()
        funded += 1
    
    print(f"  âœ… Wallets funded: {funded}")

def create_reviews(users):
    """Create product reviews."""
    print("\nâ­ Creating reviews...")
    
    completed_orders = Order.objects.filter(status=OrderStatus.COMPLETED)
    reviews_created = 0
    
    for order in completed_orders[:20]:  # Review some completed orders
        if random.random() > 0.7:  # 70% chance of review
            reviewer = order.wholesaler or order.retailer
            reviewee = order.farmer or order.wholesaler
            
            if reviewer and reviewee:
                Review.objects.create(
                    order=order,
                    reviewer=reviewer,
                    reviewee=reviewee,
                    rating=random.randint(4, 5),  # Mostly positive reviews
                    comment=random.choice([
                        "Excellent quality products, highly recommended!",
                        "Very professional and timely delivery.",
                        "Great communication and product quality.",
                        "Will definitely order again. Very satisfied.",
                        "Good quality and fair pricing.",
                    ])
                )
                reviews_created += 1
    
    print(f"  âœ… Reviews created: {reviews_created}")

def create_notifications(users):
    """Create sample notifications."""
    print("\nðŸ”” Creating notifications...")
    
    notification_types = [
        (NotificationType.ORDER, "New order received"),
        (NotificationType.PAYMENT, "Payment released to your wallet"),
        (NotificationType.APPROVAL, "Your account has been approved"),
        (NotificationType.PRODUCT, "Your product listing is now active"),
        (NotificationType.MESSAGE, "You have a new message"),
    ]
    
    notifications_created = 0
    
    for user in users[:30]:  # Create notifications for some users
        num_notifications = random.randint(2, 8)
        for _ in range(num_notifications):
            notif_type, message = random.choice(notification_types)
            Notification.objects.create(
                recipient=user,
                type=notif_type,
                message=message,
                is_read=random.choice([True, False])
            )
            notifications_created += 1
    
    print(f"  âœ… Notifications created: {notifications_created}")

def create_bank_accounts(users):
    """Create bank accounts for users."""
    print("\nðŸ¦ Creating bank accounts...")
    
    # Ensure banks exist
    banks_data = [
        "Commercial Bank of Ethiopia",
        "Awash Bank",
        "Dashen Bank",
        "Bank of Abyssinia",
        "Cooperative Bank of Oromia",
    ]
    
    for bank_name in banks_data:
        PayoutBank.objects.get_or_create(
            name=bank_name,
            defaults={"is_active": True, "code": bank_name[:3].upper()}
        )
    
    banks = PayoutBank.objects.filter(is_active=True)
    accounts_created = 0
    
    farmers = [u for u in users if u.role == "FARMER"]
    wholesalers = [u for u in users if u.role == "WHOLESALER"]
    
    for user in farmers[:10] + wholesalers[:7]:  # Some users have bank accounts
        bank = random.choice(banks)
        account_number = f"{random.randint(1000000000, 9999999999)}"
        
        BankAccount.objects.create(
            user=user,
            bank=bank,
            account_holder_name=user.full_name,
            account_number_encrypted=account_number,  # In real system this would be encrypted
            account_number_last4=account_number[-4:],
            status=BankAccount.Status.NOT_VERIFIED
        )
        accounts_created += 1
    
    print(f"  âœ… Bank accounts created: {accounts_created}")

def print_summary():
    """Print summary of seeded data."""
    print("\n" + "=" * 80)
    print("SEEDING COMPLETED SUCCESSFULLY!")
    print("=" * 80)
    print(f"\n[SUMMARY] DATABASE SUMMARY:")
    print(f"  Total Users: {User.objects.count()}")
    print(f"    - Farmers: {User.objects.filter(role='FARMER').count()}")
    print(f"    - Wholesalers: {User.objects.filter(role='WHOLESALER').count()}")
    print(f"    - Retailers: {User.objects.filter(role='RETAILER').count()}")
    print(f"    - Drivers: {User.objects.filter(role='DRIVER').count()}")
    print(f"    - Admins: {User.objects.filter(role='USER_ADMIN').count()}")
    print(f"    - Financial Managers: {User.objects.filter(role='FINANCIAL_MANAGER').count()}")
    print(f"    - Super Admins: {User.objects.filter(role='SUPER_ADMIN').count()}")
    print(f"\n  Product Listings: {Product.objects.count()}")
    print(f"    - Farmer Listings: {Product.objects.filter(product_type=ProductType.FARMER_LISTING).count()}")
    print(f"    - Wholesaler Listings: {Product.objects.filter(product_type=ProductType.WHOLESALER_LISTING).count()}")
    print(f"    - Active: {Product.objects.filter(status=ProductStatus.ACTIVE).count()}")
    print(f"\n  Orders: {Order.objects.count()}")
    print(f"    - Completed: {Order.objects.filter(status=OrderStatus.COMPLETED).count()}")
    print(f"    - Delivered: {Order.objects.filter(status=OrderStatus.DELIVERED).count()}")
    print(f"    - In Progress: {Order.objects.exclude(status__in=[OrderStatus.COMPLETED, OrderStatus.CANCELLED if hasattr(OrderStatus, 'CANCELLED') else 'CANCELLED']).count()}")
    print(f"\n  Financial:")
    print(f"    - Wallets: {Wallet.objects.count()}")
    print(f"    - Total Balance: ETB {Wallet.objects.aggregate(total=django.db.models.Sum('available_balance'))['total'] or 0:,.2f}")
    print(f"    - Transactions: {WalletTransaction.objects.count()}")
    print(f"    - Bank Accounts: {BankAccount.objects.count()}")
    print(f"\n  Reviews: {Review.objects.count()}")
    print(f"  Notifications: {Notification.objects.count()}")
    print(f"  Locations: {AdministrativeLocation.objects.count()}")
    print(f"  Product Catalog: {AgriculturalProductType.objects.count()} products")
    
    print(f"\nðŸ”‘ TEST CREDENTIALS:")
    print(f"  All users have password: Green@2024")
    print(f"  Examples:")
    print(f"    - Super Admin: superadmin01 / Green@2024")
    print(f"    - Financial Manager: financial_manager01 / Green@2024")
    print(f"    - User Admin: user_admin01 / Green@2024")
    print(f"    - Farmer: farmer01 / Green@2024")
    print(f"    - Wholesaler: wholesaler01 / Green@2024")
    print(f"    - Retailer: retailer01 / Green@2024")
    print(f"    - Driver: driver01 / Green@2024")
    
    print(f"\nâœ… Ready for beautiful, dynamic dashboards!")
    print(f"Completed at: {timezone.now()}")
    print("=" * 80)

def main():
    """Main seeding function."""
    try:
        # Create base data
        locations = create_locations()
        product_types = create_product_catalog()
        users = create_users_and_registrations(locations)
        
        # Create marketplace data
        create_products_and_listings(users, product_types)
        fund_wallets(users)
        create_orders_and_transactions(users)
        
        # Create engagement data
        create_reviews(users)
        create_notifications(users)
        create_bank_accounts(users)
        
        # Print summary
        print_summary()
        
    except Exception as e:
        print(f"\nâŒ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
