"""
AdPilot AI - Product Intelligence Schemas
Strict Pydantic models for product data extraction, image metadata, reviews, and diagnostics.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, HttpUrl, field_validator


class ProductImage(BaseModel):
    """Extracted product image with source provenance and dimensions."""
    url: str = Field(description="Normalized high-resolution image URL")
    alt_text: Optional[str] = Field(default=None, description="Image alt description")
    is_primary: bool = Field(default=False, description="Whether this is the primary hero image")
    width: Optional[int] = Field(default=None, description="Image width in pixels if known")
    height: Optional[int] = Field(default=None, description="Image height in pixels if known")
    format: Optional[str] = Field(default=None, description="Image format: jpg, png, webp, etc.")
    source: str = Field(default="html", description="Extraction source: json_ld, open_graph, html, etc.")


class ProductReview(BaseModel):
    """Customer review sample extracted from public product page."""
    author: Optional[str] = Field(default=None, description="Reviewer name or alias")
    rating: Optional[float] = Field(default=None, ge=1.0, le=5.0, description="Review rating (1-5)")
    title: Optional[str] = Field(default=None, description="Review headline/title")
    content: Optional[str] = Field(default=None, description="Review text body")
    date: Optional[str] = Field(default=None, description="Review date string if available")
    verified: Optional[bool] = Field(default=None, description="Whether purchase is verified")


class Product(BaseModel):
    """
    Strict product model with field-level provenance and confidence scoring.
    Missing values are explicitly distinguished from zero or empty strings.
    """
    product_name: str = Field(description="Name or title of the product")
    brand: Optional[str] = Field(default=None, description="Brand or manufacturer")
    category: Optional[str] = Field(default=None, description="Product category or breadcrumb")
    description: Optional[str] = Field(default=None, description="Detailed product description")
    price: Optional[float] = Field(default=None, description="Current selling price (None if missing)")
    original_price: Optional[float] = Field(default=None, description="Original/MRP price (None if missing)")
    currency: Optional[str] = Field(default=None, description="Currency code (e.g. INR, USD)")
    discount: Optional[float] = Field(default=None, description="Discount percentage (e.g. 25.0 for 25% off)")
    features: List[str] = Field(default_factory=list, description="List of key product features/highlights")
    specifications: Dict[str, Any] = Field(default_factory=dict, description="Key-value product specifications")
    images: List[ProductImage] = Field(default_factory=list, description="Extracted product images")
    reviews: List[ProductReview] = Field(default_factory=list, description="Public customer reviews")
    rating: Optional[float] = Field(default=None, ge=0.0, le=5.0, description="Aggregate rating (0-5)")
    review_count: Optional[int] = Field(default=None, ge=0, description="Total number of reviews")
    availability: str = Field(default="Unknown", description="InStock, OutOfStock, PreOrder, Unknown")
    product_url: str = Field(description="Canonical product URL")
    source_urls: List[str] = Field(default_factory=list, description="All source URLs visited or referenced")
    extraction_timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp of extraction"
    )
    field_confidence: Dict[str, float] = Field(
        default_factory=dict,
        description="Confidence score (0.0 to 1.0) for each extracted field"
    )
    field_provenance: Dict[str, str] = Field(
        default_factory=dict,
        description="Source provenance for each extracted field (json_ld, open_graph, html_table, etc.)"
    )
    missing_fields: List[str] = Field(
        default_factory=list,
        description="List of required or standard fields that could not be extracted"
    )


class ExtractionDiagnostics(BaseModel):
    """Detailed diagnostics of the extraction execution."""
    url: str = Field(description="Requested URL")
    domain: str = Field(description="Target website domain")
    extractor_name: str = Field(description="Name of the extractor used")
    extraction_method: str = Field(description="Method used: http_json_ld, http_html, playwright_rendered")
    js_rendered: bool = Field(default=False, description="Whether JavaScript rendering was required")
    duration_ms: float = Field(description="Total execution time in milliseconds")
    status_code: Optional[int] = Field(default=None, description="HTTP response status code")
    retries: int = Field(default=0, description="Number of HTTP retry attempts")
    field_confidence: Dict[str, float] = Field(default_factory=dict)
    missing_fields: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list, description="Warnings or issues encountered")


class ProductExtractRequest(BaseModel):
    """Request payload for product extraction."""
    url: Optional[str] = Field(default=None, description="Product page URL")
    product_url: Optional[str] = Field(default=None, description="Alternative field for product URL")
    force_js: bool = Field(default=False, description="Force headless browser rendering")

    @field_validator("product_url", mode="before")
    @classmethod
    def sync_urls(cls, v, values):
        return v

    def get_target_url(self) -> str:
        target = self.url or self.product_url
        if not target or not target.strip():
            raise ValueError("Either 'url' or 'product_url' must be provided.")
        return target.strip()


class ProductExtractResponse(BaseModel):
    """Response payload for product extraction."""
    success: bool = Field(description="Whether product extraction succeeded")
    data: Optional[Product] = Field(default=None, description="Extracted product data if successful")
    diagnostics: ExtractionDiagnostics = Field(description="Extraction diagnostics and provenance")
    error: Optional[str] = Field(default=None, description="Error message if extraction failed")

