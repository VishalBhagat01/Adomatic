"""
AdPilot AI - Advertising Placement Specifications Registry
Resolves placement identifiers and formats into technical aspect ratios,
resolutions, safe zones, and duration constraints.
"""

from typing import Dict, Literal, Optional
from agent.app.schemas.creative import PlacementSpecification

PLACEMENT_CATALOG: Dict[tuple[str, str], PlacementSpecification] = {
    ("instagram_feed", "image"): PlacementSpecification(
        placement="instagram_feed",
        format="image",
        aspect_ratio="4:5",
        recommended_resolution="1080x1350",
        safe_zone_notes="Keep focal product and headline inside centered 90% margin; crisp vertical feed thumb-stop framing.",
    ),
    ("instagram_feed", "video"): PlacementSpecification(
        placement="instagram_feed",
        format="video",
        aspect_ratio="4:5",
        recommended_resolution="1080x1350",
        safe_zone_notes="Keep subtitles in lower-middle 15% margin without cropping hero product housing.",
        default_duration_seconds=15,
    ),
    ("instagram_reels", "video"): PlacementSpecification(
        placement="instagram_reels",
        format="video",
        aspect_ratio="9:16",
        recommended_resolution="1080x1920",
        safe_zone_notes="Leave top 14%, bottom 22% (caption/CTA UI), and right 15% (like/comment icons) free of critical text or product controls.",
        default_duration_seconds=15,
    ),
    ("instagram_reels", "image"): PlacementSpecification(
        placement="instagram_reels",
        format="image",
        aspect_ratio="9:16",
        recommended_resolution="1080x1920",
        safe_zone_notes="Full vertical 9:16 canvas; reserve bottom 22% and right edge for platform UI overlays.",
    ),
    ("instagram_stories", "image"): PlacementSpecification(
        placement="instagram_stories",
        format="image",
        aspect_ratio="9:16",
        recommended_resolution="1080x1920",
        safe_zone_notes="Keep top 14% (profile bar) and bottom 20% (swipe/link CTA) clear of text and key product details.",
    ),
    ("instagram_stories", "video"): PlacementSpecification(
        placement="instagram_stories",
        format="video",
        aspect_ratio="9:16",
        recommended_resolution="1080x1920",
        safe_zone_notes="Keep top 14% and bottom 20% clear; fast 1-second visual hook.",
        default_duration_seconds=15,
    ),
    ("facebook_feed", "image"): PlacementSpecification(
        placement="facebook_feed",
        format="image",
        aspect_ratio="1:1",
        recommended_resolution="1080x1080",
        safe_zone_notes="Balanced square product frame with clear headline zone above or beside product.",
    ),
    ("facebook_feed", "video"): PlacementSpecification(
        placement="facebook_feed",
        format="video",
        aspect_ratio="4:5",
        recommended_resolution="1080x1350",
        safe_zone_notes="Design for sound-off autoplay with legible upper-third captions.",
        default_duration_seconds=15,
    ),
    ("youtube_shorts", "video"): PlacementSpecification(
        placement="youtube_shorts",
        format="video",
        aspect_ratio="9:16",
        recommended_resolution="1080x1920",
        safe_zone_notes="Avoid bottom 25% and right 15% engagement rails.",
        default_duration_seconds=15,
    ),
    ("youtube_shorts", "image"): PlacementSpecification(
        placement="youtube_shorts",
        format="image",
        aspect_ratio="9:16",
        recommended_resolution="1080x1920",
        safe_zone_notes="Full vertical 9:16 image card; keep bottom 25% and right 15% engagement rails clear.",
    ),
    ("youtube_instream", "video"): PlacementSpecification(
        placement="youtube_instream",
        format="video",
        aspect_ratio="16:9",
        recommended_resolution="1920x1080",
        safe_zone_notes="Reserve bottom-right skip button safe zone after 5s.",
        default_duration_seconds=15,
    ),
    ("web_banner", "image"): PlacementSpecification(
        placement="web_banner",
        format="image",
        aspect_ratio="16:9",
        recommended_resolution="1920x1080",
        safe_zone_notes="Keep product on right/left rule-of-thirds anchor with clean negative space for web hero copy.",
    ),
}


def resolve_placement_spec(
    placement: str,
    fmt: Literal["image", "video"],
    requested_duration: Optional[int] = None,
) -> PlacementSpecification:
    """Resolve exact technical spec for a (placement, format) pair with sensible defaults."""
    norm = placement.strip().lower()
    if (norm, fmt) in PLACEMENT_CATALOG:
        base = PLACEMENT_CATALOG[(norm, fmt)]
        if fmt == "video" and requested_duration:
            return base.model_copy(update={"default_duration_seconds": requested_duration})
        return base

    # Infer geometry cleanly for unknown placement labels
    if any(k in norm for k in ("reel", "story", "stories", "short", "tiktok", "vertical")):
        aspect = "9:16"
        res = "1080x1920"
        safe = "Reserve bottom 20% and top 14% for mobile UI chrome."
    elif any(k in norm for k in ("youtube", "banner", "hero", "landscape", "desktop")):
        aspect = "16:9"
        res = "1920x1080"
        safe = "Maintain clean 10% horizontal edge margins."
    else:
        aspect = "1:1" if fmt == "image" else "4:5"
        res = "1080x1080" if fmt == "image" else "1080x1350"
        safe = "Center hero product with 10% outer padding."

    return PlacementSpecification(
        placement=norm,
        format=fmt,
        aspect_ratio=aspect,
        recommended_resolution=res,
        safe_zone_notes=safe,
        default_duration_seconds=(requested_duration or 15) if fmt == "video" else None,
    )

