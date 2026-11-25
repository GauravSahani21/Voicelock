from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.database.session import SessionLocal
from app.models.entities import EndUser, OperatorAccount, Tenant


DEMO_TENANTS = [
    {
        "slug": "demo-telecom",
        "name": "Demo Telecom",
        "industry": "telecom",
        "users": [
            {
                "external_reference": "CUST-TEL-001",
                "name": "Aarav Sharma (Customer 001)",
                "email": "customer001@demotelecom.example",
                "phone_reference": "+1-555-0101",
                "role": "customer",
                "metadata_json": {
                    "masked_phone": "+1 (555) •••-0101",
                    "sim_iccid": "8901410321111851001",
                    "sim_type": "eSIM + Physical Nano-SIM",
                    "sim_status": "Active",
                    "last_sim_update": "2026-08-14",
                    "registered_device": "Apple iPhone 15 Pro (iOS 18.2)",
                    "plan": "5G Unlimited Postpaid",
                    "account_tier": "standard",
                    "recent_activity": [
                        {"date": "2026-11-18", "event": "Monthly billing statement generated ($68.00)"},
                        {"date": "2026-10-29", "event": "International roaming pass activated"},
                    ],
                },
            },
            {
                "external_reference": "CUST-TEL-002",
                "name": "Priya Nair (Customer 002)",
                "email": "customer002@demotelecom.example",
                "phone_reference": "+1-555-0102",
                "role": "customer",
                "metadata_json": {
                    "masked_phone": "+1 (555) •••-0102",
                    "sim_iccid": "8901410321111851002",
                    "sim_type": "Physical Nano-SIM",
                    "sim_status": "Active",
                    "last_sim_update": "2026-06-03",
                    "registered_device": "Samsung Galaxy S24 Ultra",
                    "plan": "Enterprise Roaming Pro",
                    "account_tier": "vip",
                    "recent_activity": [
                        {"date": "2026-11-20", "event": "Data top-up 20 GB confirmed"},
                        {"date": "2026-11-01", "event": "Auto-pay cleared"},
                    ],
                },
            },
        ],
    },
    {
        "slug": "demo-enterprise",
        "name": "Demo Enterprise",
        "industry": "helpdesk",
        "users": [
            {
                "external_reference": "EMP-ENT-001",
                "name": "Elena Rostova (Employee 001)",
                "email": "employee001@demoenterprise.example",
                "phone_reference": "+1-555-0201",
                "role": "employee",
                "metadata_json": {
                    "masked_phone": "+1 (555) •••-0201",
                    "department": "Cloud Infrastructure",
                    "designation": "Staff Site Reliability Engineer",
                    "registered_device": "MacBook Pro 16 (MDM-8821)",
                    "mfa_device": "Hardware Token #441",
                    "mfa_status": "Enrolled (FIDO2 + TOTP)",
                    "privilege_level": "elevated",
                },
            },
            {
                "external_reference": "EMP-ENT-002",
                "name": "Marcus Vance (Employee 002)",
                "email": "employee002@demoenterprise.example",
                "phone_reference": "+1-555-0202",
                "role": "employee",
                "metadata_json": {
                    "masked_phone": "+1 (555) •••-0202",
                    "department": "Finance Operations",
                    "designation": "Senior Financial Analyst",
                    "registered_device": "ThinkPad X1 Carbon (MDM-4412)",
                    "mfa_device": "Authenticator App",
                    "mfa_status": "Enrolled (TOTP)",
                    "privilege_level": "standard",
                },
            },
        ],
    },
    {
        "slug": "demo-bank",
        "name": "Demo Bank",
        "industry": "banking",
        "users": [
            {
                "external_reference": "BNK-CUST-001",
                "name": "Claire Bennett (Customer 001)",
                "email": "customer001@demobank.example",
                "phone_reference": "+1-555-0301",
                "role": "customer",
                "metadata_json": {
                    "masked_phone": "+1 (555) •••-0301",
                    "account_mask": "••••-••••-8821",
                    "account_type": "Premier Checking",
                    "segment": "Premier Checking",
                    "daily_transfer_limit": 25000,
                },
            },
        ],
    },
    {
        "slug": "demo-university",
        "name": "Demo University",
        "industry": "education",
        "users": [
            {
                "external_reference": "STU-UNI-001",
                "name": "Liam Chen (Student 001)",
                "email": "student001@demouniversity.example",
                "phone_reference": "+1-555-0401",
                "role": "student",
                "metadata_json": {
                    "masked_phone": "+1 (555) •••-0401",
                    "department": "Computer Science & Engineering",
                    "course": "B.S. Computer Science (Year 3)",
                    "program": "B.S. Computer Science",
                    "gpa_standing": "Good Standing (3.84 GPA)",
                    "advisor": "Dr. Maya Lin",
                },
            },
            {
                "external_reference": "FAC-UNI-001",
                "name": "Dr. Maya Lin (Faculty 001)",
                "email": "faculty001@demouniversity.example",
                "phone_reference": "+1-555-0402",
                "role": "faculty",
                "metadata_json": {
                    "masked_phone": "+1 (555) •••-0402",
                    "department": "Computer Science",
                    "course": "CS-401 Distributed Systems",
                    "title": "Associate Professor",
                },
            },
            {
                "external_reference": "ADM-UNI-001",
                "name": "Dean Arthur Pendelton (University Admin)",
                "email": "uniadmin001@demouniversity.example",
                "phone_reference": "+1-555-0403",
                "role": "administrator",
                "metadata_json": {
                    "masked_phone": "+1 (555) •••-0403",
                    "department": "Office of the Registrar",
                    "office": "Office of the Registrar",
                    "clearance": "registrar_write",
                },
            },
        ],
    },
]


def seed_demo_data(db: Session) -> dict[str, int]:
    """Idempotently seed fictional demo tenants, end-users, and operator accounts."""
    tenants_created = 0
    users_created = 0
    operators_created = 0

    tenant_map: dict[str, Tenant] = {}

    for t_spec in DEMO_TENANTS:
        tenant = db.scalar(select(Tenant).where(Tenant.slug == t_spec["slug"]))
        if not tenant:
            tenant = Tenant(
                slug=t_spec["slug"],
                name=t_spec["name"],
                industry=t_spec["industry"],
                status="active",
            )
            db.add(tenant)
            db.flush()
            tenants_created += 1
        tenant_map[t_spec["slug"]] = tenant

        for u_spec in t_spec["users"]:
            existing_user = db.scalar(
                select(EndUser).where(
                    EndUser.tenant_id == tenant.id,
                    EndUser.external_reference == u_spec["external_reference"],
                )
            )
            if not existing_user:
                db.add(
                    EndUser(
                        tenant_id=tenant.id,
                        external_reference=u_spec["external_reference"],
                        name=u_spec["name"],
                        email=u_spec["email"],
                        phone_reference=u_spec["phone_reference"],
                        role=u_spec["role"],
                        metadata_json=u_spec["metadata_json"],
                    )
                )
                users_created += 1
            else:
                merged = dict(existing_user.metadata_json or {})
                changed = False
                for mk, mv in u_spec["metadata_json"].items():
                    if mk not in merged:
                        merged[mk] = mv
                        changed = True
                if changed:
                    existing_user.metadata_json = merged

    operator_specs = [
        {
            "email": "admin@voicelock.demo",
            "full_name": "VoiceLock Security Admin",
            "password": "DemoAdmin!2026",
            "role": "platform_admin",
            "tenant_id": None,
        },
        {
            "email": "telecom.ops@voicelock.demo",
            "full_name": "Telecom Fraud Operator",
            "password": "DemoTelecom!2026",
            "role": "operator",
            "tenant_id": tenant_map["demo-telecom"].id,
        },
        {
            "email": "helpdesk.ops@voicelock.demo",
            "full_name": "Helpdesk Security Operator",
            "password": "DemoHelpdesk!2026",
            "role": "operator",
            "tenant_id": tenant_map["demo-enterprise"].id,
        },
        {
            "email": "bank.ops@voicelock.demo",
            "full_name": "Bank Fraud Specialist",
            "password": "DemoBank!2026",
            "role": "operator",
            "tenant_id": tenant_map["demo-bank"].id,
        },
        {
            "email": "registrar.ops@voicelock.demo",
            "full_name": "University Registrar Operator",
            "password": "DemoUni!2026",
            "role": "operator",
            "tenant_id": tenant_map["demo-university"].id,
        },
    ]

    for op_spec in operator_specs:
        existing_op = db.scalar(
            select(OperatorAccount).where(OperatorAccount.email == op_spec["email"])
        )
        if not existing_op:
            db.add(
                OperatorAccount(
                    email=op_spec["email"],
                    full_name=op_spec["full_name"],
                    password_hash=hash_password(op_spec["password"]),
                    role=op_spec["role"],
                    tenant_id=op_spec["tenant_id"],
                    is_active=True,
                )
            )
            operators_created += 1

    db.commit()
    return {
        "tenants_created": tenants_created,
        "users_created": users_created,
        "operators_created": operators_created,
    }


if __name__ == "__main__":
    with SessionLocal() as session:
        summary = seed_demo_data(session)
        print("Seed complete:", summary)
