"""
AdPilot AI - Product Extraction API Endpoint
POST /api/v1/products/extract
Accepts a product URL, executes the multi-stage extraction pipeline, and returns
structured product intelligence with provenance and diagnostics.
"""

from fastapi import APIRouter, HTTPException, status

from agent.app.core.logging import logger
from agent.app.schemas.product import (
    ProductExtractRequest,
    ProductExtractResponse,
)
from agent.app.services.extractor.engine import extraction_engine

router = APIRouter(prefix="/products", tags=["Products"])


@router.post(
    "/extract",
    response_model=ProductExtractResponse,
    status_code=status.HTTP_200_OK,
    summary="Extract product information from e-commerce URL",
    description=(
        "Extracts structured product data including title, pricing, specifications, "
        "features, high-resolution images, and reviews with field-level provenance."
    ),
)
async def extract_product(request: ProductExtractRequest) -> ProductExtractResponse:
    try:
        target_url = request.get_target_url()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    logger.info(f"Received product extraction request for: {target_url}")

    result = await extraction_engine.extract_product(
        url=target_url,
        force_js=request.force_js,
    )

    if not result.success:
        if "SSRF" in (result.error or "") or "blocked" in result.diagnostics.extraction_method:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": result.error,
                    "diagnostics": result.diagnostics.model_dump(),
                },
            )
        # Return 200 with success=False and diagnostics, or 422
        # Returning response object preserves full diagnostics for the client
        return result

    return result

