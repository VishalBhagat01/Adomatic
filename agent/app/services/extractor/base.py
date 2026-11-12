"""
AdPilot AI - Base E-Commerce Extractor Interface
Defines the contract for website-specific and generic product extractors.
"""

from abc import ABC, abstractmethod
from typing import Optional
from bs4 import BeautifulSoup

from agent.app.schemas.product import Product


class BaseExtractor(ABC):
    """Abstract base class for e-commerce product extraction."""

    name: str = "base_extractor"

    @abstractmethod
    def can_handle(self, domain: str) -> bool:
        """Return True if this extractor specializes in the target domain."""
        pass

    @abstractmethod
    def extract(self, soup: BeautifulSoup, product_url: str) -> Product:
        """Extract structured product information from the parsed BeautifulSoup DOM."""
        pass

