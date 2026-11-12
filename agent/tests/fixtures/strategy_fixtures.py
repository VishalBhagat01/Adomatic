"""
Reusable product and strategy fixtures for testing Step 05 (Product Understanding & Marketing Strategy).
"""

from typing import Any, Dict
from agent.app.schemas.product import Product, ProductImage, ProductReview


def make_lifelong_mixer_product() -> Product:
    return Product(
        product_name="Lifelong LLM99 Mixer Grinder 500W with 3 Stainless Steel Jars",
        brand="Lifelong",
        category="Kitchen Appliances",
        description=(
            "The Lifelong LLM99 500 Watt Mixer Grinder is built for everyday Indian cooking. "
            "Includes 3 stainless steel jars, 3-speed rotary control with pulse function, "
            "and overload protection."
        ),
        price=1499.0,
        original_price=2499.0,
        currency="INR",
        discount=40.0,
        features=[
            "Powerful 500-watt turbo motor for fast grinding",
            "3 durable stainless steel jars: Chutney (0.35L), Dry (0.8L), Liquidizing (1.25L)",
            "3-speed rotary switch with incher/pulse mode",
            "Overload protector with anti-skid vacuum feet",
            "1 Year Lifelong Brand Warranty",
        ],
        specifications={
            "Brand": "Lifelong",
            "Model": "LLM99",
            "Wattage": "500 Watts",
            "Voltage": "230V, 50Hz",
            "Jars Included": "3 Stainless Steel Jars",
            "Color": "White and Grey",
            "Warranty": "1 Year Domestic Warranty",
        },
        images=[
            ProductImage(
                url="https://cdn.shopify.com/s/files/1/0000/0001/products/mixer1.jpg",
                alt_text="Lifelong Mixer Grinder 500W Front View",
                is_primary=True,
                format="jpg",
                source="json_ld",
            ),
            ProductImage(
                url="https://cdn.shopify.com/s/files/1/0000/0001/products/mixer2.jpg",
                alt_text="Lifelong Mixer Grinder 3 Stainless Steel Jars",
                is_primary=False,
                format="jpg",
                source="json_ld",
            ),
        ],
        reviews=[
            ProductReview(
                author="Pooja Verma",
                rating=5.0,
                title="Superb Quality",
                content="Compact size, powerful grinding and very easy to clean.",
                date="2026-08-15",
            )
        ],
        rating=4.3,
        review_count=156,
        availability="InStock",
        product_url="https://www.lifelongindiaonline.com/products/lifelong-llm99-mixer-grinder-500w",
        source_urls=["https://www.lifelongindiaonline.com/products/lifelong-llm99-mixer-grinder-500w"],
        field_confidence={"product_name": 0.98, "price": 0.95},
        field_provenance={"product_name": "json_ld", "price": "json_ld_offers"},
        missing_fields=[],
    )


def make_missing_price_product() -> Product:
    return Product(
        product_name="Lifelong Commercial Blender 2000W",
        brand="Lifelong",
        category="Commercial Kitchen",
        description="Heavy duty 2000W blender with 2.5L container for cafes.",
        price=None,
        original_price=None,
        currency="INR",
        discount=None,
        features=["2000W commercial grade motor", "2.5L container"],
        specifications={"Wattage": "2000 Watts", "Capacity": "2.5 Liters"},
        images=[],
        reviews=[],
        availability="InStock",
        product_url="https://www.lifelongindiaonline.com/products/commercial-blender",
        missing_fields=["price", "original_price", "discount", "images", "reviews", "rating"],
    )


def make_valid_strategy_dict(include_cordless_audit: bool = False) -> Dict[str, Any]:
    validations = [
        {
            "claim_text": "500W motor power",
            "source": "product_data",
            "status": "supported",
            "supporting_evidence": "Specifications: Wattage = 500 Watts",
            "reason": "Verified directly in product specifications and features.",
            "safe_alternative": None,
        }
    ]
    if include_cordless_audit:
        validations.extend([
            {
                "claim_text": "cordless operation",
                "source": "user_prompt",
                "status": "contradictory",
                "supporting_evidence": None,
                "reason": "Product requires 230V, 50Hz AC supply and is not cordless.",
                "safe_alternative": "Compact countertop corded design for reliable 230V kitchen operation",
            },
            {
                "claim_text": "1000W motor",
                "source": "user_prompt",
                "status": "contradictory",
                "supporting_evidence": None,
                "reason": "Extracted specifications confirm a 500 Watts motor, not 1000W.",
                "safe_alternative": "Powerful 500W turbo motor for everyday dry and wet grinding",
            },
        ])

    return {
        "product_knowledge": {
            "product_category": "Kitchen Appliances / Mixer Grinders",
            "core_functionality": "Electric 500W countertop mixer grinder designed for daily wet grinding, dry spices, and chutney preparation.",
            "verified_features": [
                "500-watt turbo motor",
                "3 stainless steel jars (0.35L Chutney, 0.8L Dry, 1.25L Liquidizing)",
                "3-speed rotary switch with pulse/incher control",
                "Overload protector and anti-skid vacuum feet",
                "1 Year Lifelong Brand Warranty",
            ],
            "customer_benefits": [
                "Handles diverse Indian cooking prep from smooth chutneys to dry spice powders with dedicated jar sizes",
                "Anti-skid feet keep the unit stable during high-speed blending",
                "Overload protection safeguards motor longevity under heavy loads",
            ],
            "differentiating_factors": [
                "Three-jar versatility at an accessible INR 1,499 price point (40% below INR 2,499 MRP)",
                "Rated 4.3/5 across 156 customer reviews highlighting compact footprint and easy cleaning",
            ],
            "product_limitations": [
                "Requires 230V AC power outlet (corded operation only)",
                "500W motor suited for household prep rather than heavy commercial batches",
            ],
            "supported_claims": [
                "500W motor with 3 stainless steel jars",
                "Rated 4.3 stars by 156 verified-format reviewers",
                "1 Year Lifelong Brand Warranty",
            ],
            "missing_or_uncertain_info": [
                "Exact motor RPM rating and blade material grade are unspecified",
                "Exact product dimensions and weight are not listed",
            ],
        },
        "personas": [
            {
                "persona_id": "persona_1",
                "persona_name": "Busy Urban Home Cook",
                "segment_context": "Prepares daily meals, chutneys, and spice masalas in compact city kitchens.",
                "pain_points": [
                    "Bulky appliances occupy limited counter space",
                    "Motor burnout during thick paste or spice grinding",
                ],
                "purchase_motivations": [
                    "Compact footprint highlighted in customer feedback",
                    "Dedicated 0.35L chutney, 0.8L dry, and 1.25L liquidizing jars",
                ],
                "relevance_to_prompt": "Matches everyday premium kitchen lifestyle angle for young professionals.",
            },
            {
                "persona_id": "persona_2",
                "persona_name": "First-Apartment Young Professional",
                "segment_context": "Furnishing a new apartment kitchen with reliable, budget-conscious essentials.",
                "pain_points": [
                    "Overpriced multi-appliance bundles when starting out",
                    "Worry about appliance durability without warranty coverage",
                ],
                "purchase_motivations": [
                    "40% discount at INR 1,499 vs INR 2,499 MRP",
                    "Backed by 1 Year Lifelong Brand Warranty",
                ],
                "relevance_to_prompt": "Directly targets young professionals seeking high value and clean aesthetics.",
            },
        ],
        "marketing_angles": [
            {
                "angle_id": "angle_1",
                "angle_name": "Three-Jar Precision for Daily Indian Prep",
                "target_persona_id": "persona_1",
                "core_promise": "Tackle morning smoothies, fresh chutneys, and roasted spices cleanly with three dedicated stainless steel jars.",
                "supporting_facts": [
                    "Includes 0.35L chutney jar, 0.8L dry jar, and 1.25L liquidizing jar",
                    "3-speed rotary control with pulse mode",
                ],
                "recommended_messaging": "Stop compromising with single-jar blenders. Switch seamlessly between 0.35L chutney grinding, 0.8L spice blends, and 1.25L smoothies with 3-speed pulse precision.",
                "visual_direction": "Warm morning kitchen countertop shot featuring the white-and-grey mixer beside all three stainless steel jars filled with colorful ingredients.",
                "hooks": [
                    "Three stainless steel jars, zero morning kitchen chaos.",
                    "Why settle for one jar when fresh chutney takes seconds?",
                ],
                "cta_recommendations": ["Upgrade Your Kitchen", "Shop Lifelong LLM99"],
                "recommended_placements": ["instagram_reels", "instagram_feed"],
            },
            {
                "angle_id": "angle_2",
                "angle_name": "Built-In Safety & Compact Power",
                "target_persona_id": "persona_1",
                "core_promise": "500W turbo grinding power engineered with anti-skid vacuum feet and motor overload protection.",
                "supporting_facts": [
                    "500W turbo motor",
                    "Overload protector and anti-skid vacuum feet",
                ],
                "recommended_messaging": "Small counter, heavy prep? The compact 500W LLM99 locks firmly onto your countertop with vacuum feet and protects itself from overload.",
                "visual_direction": "Close-up slow-motion reel showing smooth rotary dial twist, steady countertop grip, and effortless spice texture transformation.",
                "hooks": [
                    "Compact footprint, 500W grinding muscle.",
                    "Tired of mixers dancing across your kitchen counter?",
                ],
                "cta_recommendations": ["See Specs & Buy", "Order Today"],
                "recommended_placements": ["instagram_reels"],
            },
            {
                "angle_id": "angle_3",
                "angle_name": "Smart First-Kitchen Value Pick",
                "target_persona_id": "persona_2",
                "core_promise": "Get 4.3-star kitchen reliability and a 1-year brand warranty at 40% off MRP.",
                "supporting_facts": [
                    "INR 1,499 sale price (INR 2,499 MRP)",
                    "4.3/5 rating across 156 reviews and 1 Year Warranty",
                ],
                "recommended_messaging": "Setting up your kitchen shouldn't drain your budget. Get the 4.3-star rated Lifelong 500W Mixer Grinder at ₹1,499—complete with 3 steel jars and 1-year warranty.",
                "visual_direction": "Minimalist studio carousel contrasting the clean white/grey motor body against modern apartment cabinetry with crisp value callout badge.",
                "hooks": [
                    "Upgrade your apartment kitchen under ₹1,500.",
                    "156 reviewers rated this compact 500W grinder 4.3 stars.",
                ],
                "cta_recommendations": ["Claim 40% Off", "Shop Now"],
                "recommended_placements": ["instagram_feed"],
            },
        ],
        "claim_validations": validations,
        "recommendations": {
            "priority_angle_id": "angle_1",
            "recommended_formats": ["video", "image"],
            "placement_recommendations": [
                {
                    "placement": "instagram_reels",
                    "format": "video",
                    "creative_direction": "Fast 15-second demo transitioning through all 3 jars in real kitchen lighting.",
                    "hook_style": "Visual transformation hook in first 2 seconds showing whole spices turning fine.",
                },
                {
                    "placement": "instagram_feed",
                    "format": "image",
                    "creative_direction": "Clean hero packshot highlighting 3 stainless steel jars and ₹1,499 offer.",
                    "hook_style": "Benefit-driven headline overlay.",
                },
            ],
            "primary_cta": "Shop Lifelong LLM99",
            "secondary_cta": "Explore Kitchen Essentials",
            "creative_dos": [
                "Showcase all 3 stainless steel jars and compact white/grey motor unit clearly",
                "State accurate 500W wattage and 1-year warranty",
            ],
            "creative_donts": [
                "Do not depict the mixer operating unplugged or cordless",
                "Do not claim wattage higher than 500W",
            ],
        },
        "prompt_alignment_notes": (
            "Adopted the premium modern Instagram aesthetic targeting young professionals while strictly enforcing "
            "factual 500W corded specifications, 1-year warranty, and ₹1,499 pricing."
        ),
    }

