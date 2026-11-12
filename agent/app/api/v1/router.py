from fastapi import APIRouter
from agent.app.api.v1.endpoints import creative, evaluations, health, images, products, strategy, videos

api_v1_router = APIRouter()
api_v1_router.include_router(health.router)
api_v1_router.include_router(products.router)
api_v1_router.include_router(strategy.router)
api_v1_router.include_router(creative.router)
api_v1_router.include_router(images.router)
api_v1_router.include_router(videos.router)
api_v1_router.include_router(evaluations.router)


