"""
Reusable fixtures, synthetic commercial product images, fake S3 client,
and httpx mock transport helpers for Step 07 image generation tests.
"""

import io
from typing import Any, Callable, Dict, List, Optional, Tuple
from botocore.exceptions import ClientError
import httpx
from PIL import Image, ImageDraw

from agent.app.schemas.creative import (
    GenerationPrompt,
    ImageCreativeBlueprint,
    PlacementSpecification,
    ReferenceImageConstraints,
)


def make_synthetic_product_image_bytes(
    width: int = 896,
    height: int = 1120,
    fmt: str = "PNG",
    variant_seed: int = 0,
    blank: bool = False,
) -> bytes:
    """
    Create a crisp synthetic studio product illustration in memory using Pillow.
    Variant seeds gently change background lighting/accent props while preserving
    central white-and-grey mixer housing tonal cues so perceptual hashes differ cleanly.
    """
    if blank:
        img = Image.new("RGB", (width, height), (240, 240, 240))
    else:
        bg_palettes = [
            (238, 242, 246),
            (245, 238, 228),
            (226, 232, 240),
            (242, 244, 240),
        ]
        bg = bg_palettes[variant_seed % len(bg_palettes)]
        img = Image.new("RGB", (width, height), bg)
        draw = ImageDraw.Draw(img)

        # Countertop band
        counter_y = int(height * 0.68)
        counter_tone = (204 - (variant_seed * 12) % 40, 198, 190)
        draw.rectangle([0, counter_y, width, height], fill=counter_tone)

        # Product body centered (white housing + metallic stainless jar + charcoal dial)
        cx, cy = width // 2, int(height * 0.50)
        body_w = int(width * 0.28)
        body_h = int(height * 0.26)
        draw.rounded_rectangle(
            [cx - body_w // 2, cy, cx + body_w // 2, cy + body_h],
            radius=18,
            fill=(248, 249, 250),
            outline=(110, 118, 129),
            width=4,
        )
        # Stainless jar on top
        jar_w = int(body_w * 0.68)
        jar_h = int(height * 0.20)
        draw.rectangle(
            [cx - jar_w // 2, cy - jar_h, cx + jar_w // 2, cy + 4],
            fill=(182, 190, 200),
            outline=(85, 92, 102),
            width=3,
        )
        # Rotary control dial
        dial_r = max(12, int(body_w * 0.14))
        draw.ellipse(
            [cx - dial_r, cy + body_h // 2 - dial_r, cx + dial_r, cy + body_h // 2 + dial_r],
            fill=(45, 55, 72),
            outline=(20, 24, 33),
            width=3,
        )

        # Subtle variation-dependent accent prop (bowls / spice spoons) for unique dHash
        prop_x = int(width * (0.20 + 0.08 * (variant_seed % 4)))
        prop_y = int(height * (0.72 - 0.02 * (variant_seed % 3)))
        draw.ellipse([prop_x, prop_y, prop_x + int(width * 0.12), prop_y + int(height * 0.08)], fill=(120, 165, 95))
        if variant_seed % 2 == 1:
            draw.line([(int(width * 0.12), int(height * 0.25)), (int(width * 0.88), int(height * 0.35))], fill=(252, 248, 232), width=6)

    buf = io.BytesIO()
    save_fmt = "JPEG" if fmt.upper() in {"JPG", "JPEG"} else fmt.upper()
    img.save(buf, format=save_fmt)
    return buf.getvalue()


def make_unrelated_neon_image_bytes(width: int = 896, height: int = 1120) -> bytes:
    """Create a vibrant neon purple/cyan diagonal image with minimal overlap to white/grey product."""
    img = Image.new("RGB", (width, height), (245, 15, 210))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, height // 2, width, height], fill=(10, 240, 220))
    draw.polygon([(0, 0), (width, 0), (width // 2, height)], fill=(130, 10, 250))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def make_sample_image_blueprint(
    aspect_ratio: str = "4:5",
    placement: str = "instagram_feed",
) -> ImageCreativeBlueprint:
    res_map = {
        "1:1": "1080x1080",
        "4:5": "1080x1350",
        "9:16": "1080x1920",
    }
    return ImageCreativeBlueprint(
        concept_id="concept_studio_hero_01",
        creative_title="Morning Countertop Power Studio Hero",
        marketing_angle="Compact Daily 3-Jar Versatility",
        audience_hypothesis="Busy urban professionals furnishing compact apartment kitchens",
        creative_objective="Drive product consideration with clean countertop hero positioning",
        hook="Grind Daily Spices & Chutneys in Seconds",
        main_message="Lifelong LLM99 500W Mixer Grinder with 3 dedicated stainless steel jars.",
        visual_composition="Centered hero studio composition inside 88% safe frame on clean marble kitchen counter.",
        background_direction="Warm minimalist apartment countertop with subtle morning sunlight.",
        lighting_direction="Crisp diffused studio key light from 45 degrees left highlighting brushed steel jar.",
        product_positioning="Full white-and-grey unit centered upright with liquidizing jar attached.",
        camera_perspective="Eye-level three-quarter hero commercial product angle.",
        brand_constraints=[
            "Preserve exact Lifelong front wordmark",
            "Keep 3-speed rotary dial clearly visible",
        ],
        negative_instructions=[
            "No digital LED displays",
            "No invented extra jars",
            "No cordless silhouette",
        ],
        reference_constraints=ReferenceImageConstraints(
            preserve_geometry="Preserve exact cylindrical motor base contour and jar lid locks",
            preserve_logo="Keep printed Lifelong logo sharp and unaltered",
            preserve_buttons_and_controls="Preserve mechanical 3-speed rotary control knob with pulse indicator",
            preserve_color_and_finish="Matte white and cool grey body with polished stainless steel jars",
            preserve_dimensions_and_proportions="Compact countertop blender footprint proportional to 1.25L hero jar",
            recognizable_design_features=[
                "White housing with grey base trim",
                "Brushed stainless steel jar",
                "Rotary dial control",
            ],
            prohibited_inventions=[
                "touchscreen display",
                "cordless battery housing",
                "fabricated copper coils",
            ],
        ),
        aspect_ratio=aspect_ratio,
        placement=placement,
        placement_spec=PlacementSpecification(
            placement=placement,
            format="image",
            aspect_ratio=aspect_ratio,
            recommended_resolution=res_map.get(aspect_ratio, "1080x1350"),
            safe_zone_notes="Keep product and any overlays inside placement safe margins.",
        ),
        image_generation_prompt=GenerationPrompt(
            prompt_id="prompt_img_01",
            target_medium="image",
            template_name="studio_product_hero_v1",
            positive_prompt=(
                "Commercial studio product shot of Lifelong LLM99 500W Mixer Grinder anchored on a bright stone kitchen counter, "
                "fresh coriander leaves nearby, soft rim light on stainless steel jar."
            ),
            negative_prompt="blurred logo, missing rotary dial, digital buttons, cluttered counter",
            aspect_ratio=aspect_ratio,
            reference_constraints=ReferenceImageConstraints(
                preserve_geometry="Preserve exact cylindrical motor base contour and jar lid locks",
                preserve_logo="Keep printed Lifelong logo sharp and unaltered",
                preserve_buttons_and_controls="Preserve mechanical 3-speed rotary control knob",
                preserve_color_and_finish="White and grey body with stainless steel jar",
                preserve_dimensions_and_proportions="Accurate 1.25L jar to motor base ratio",
            ),
            style_tags=["studio", "photorealistic", "minimalist"],
        ),
    )


class FakeS3Client:
    """In-memory boto3-compatible S3 stub capturing uploads and presigned URL generation."""

    def __init__(self):
        self.buckets: set[str] = set()
        self.objects: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def head_bucket(self, Bucket: str):
        if Bucket not in self.buckets:
            raise ClientError(
                {"Error": {"Code": "404", "Message": "Not Found"}},
                "HeadBucket",
            )
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def create_bucket(self, Bucket: str):
        self.buckets.add(Bucket)
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def put_object(self, **kwargs):
        bucket = kwargs["Bucket"]
        key = kwargs["Key"]
        self.buckets.add(bucket)
        self.objects[(bucket, key)] = {
            "Body": kwargs["Body"],
            "ContentType": kwargs.get("ContentType"),
            "Metadata": kwargs.get("Metadata", {}),
        }
        return {"ETag": '"fake-etag-123"'}

    def generate_presigned_url(self, client_method: str, Params: Dict[str, Any], ExpiresIn: int = 3600) -> str:
        return f"https://minio.local/{Params['Bucket']}/{Params['Key']}?expires={ExpiresIn}"

    def get_object(self, Bucket: str, Key: str):
        entry = self.objects.get((Bucket, Key))
        if entry is None:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "Not Found"}}, "GetObject")
        return {"Body": io.BytesIO(entry["Body"]), "ContentType": entry.get("ContentType")}


def make_mock_image_http_factory(
    url_payload_map: Dict[str, Tuple[int, str, bytes]],
) -> Callable[[], httpx.AsyncClient]:
    """Return an httpx.AsyncClient factory backed by MockTransport for offline reference fetching."""

    def handler(request: httpx.Request) -> httpx.Response:
        entry = url_payload_map.get(str(request.url))
        if entry is None:
            return httpx.Response(status_code=404, text="Not Found")
        status_code, content_type, body = entry
        return httpx.Response(
            status_code=status_code,
            headers={"Content-Type": content_type},
            content=body,
        )

    transport = httpx.MockTransport(handler)
    return lambda: httpx.AsyncClient(transport=transport, follow_redirects=False)

