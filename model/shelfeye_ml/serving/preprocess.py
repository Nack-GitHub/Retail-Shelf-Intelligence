"""Image loading and letterbox preprocessing.

⚠️ The letterbox transform is the reason bounding boxes are so easy to get
wrong. The model sees a padded, scaled square; the caller needs coordinates in
the ORIGINAL image. `LetterboxTransform` carries the exact scale and padding
used so postprocess can reverse it precisely, rather than re-deriving it and
drifting by a pixel or two.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from urllib.parse import urlparse

import numpy as np
from PIL import Image, UnidentifiedImageError


class ImageUnreadableError(Exception):
    """The bytes are not a decodable image."""


class ImageNotFoundError(Exception):
    """No object exists at the given URI."""


@dataclass(frozen=True, slots=True)
class LetterboxTransform:
    """How the original image was mapped into the model's square input."""

    scale: float
    pad_x: float
    pad_y: float
    original_width: int
    original_height: int

    def to_original(self, x: float, y: float) -> tuple[float, float]:
        """Undo padding then scaling, returning original-image pixels."""
        return (x - self.pad_x) / self.scale, (y - self.pad_y) / self.scale


def load_image(image_uri: str, storage) -> Image.Image:
    """Read the image the backend pointed at. Bytes never travel in the request."""
    parsed = urlparse(image_uri)
    if parsed.scheme in ("s3", "minio"):
        raw = storage.get_object(parsed.netloc, parsed.path.lstrip("/"))
    elif parsed.scheme in ("http", "https"):
        import httpx

        response = httpx.get(image_uri, timeout=10.0)
        if response.status_code == 404:
            raise ImageNotFoundError(image_uri)
        response.raise_for_status()
        raw = response.content
    elif parsed.scheme in ("file", ""):
        from pathlib import Path

        path = Path(parsed.path or image_uri)
        if not path.exists():
            raise ImageNotFoundError(image_uri)
        raw = path.read_bytes()
    else:
        raise ImageNotFoundError(f"unsupported URI scheme: {parsed.scheme}")

    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageUnreadableError(str(exc)) from exc


def letterbox(
    image: Image.Image, size: int, fill: int = 114
) -> tuple[np.ndarray, LetterboxTransform]:
    """Resize preserving aspect ratio, pad to a square, return NCHW float32."""
    width, height = image.size
    scale = min(size / width, size / height)
    new_w, new_h = round(width * scale), round(height * scale)

    resized = image.resize((new_w, new_h), Image.BILINEAR)
    canvas = Image.new("RGB", (size, size), (fill, fill, fill))
    pad_x, pad_y = (size - new_w) // 2, (size - new_h) // 2
    canvas.paste(resized, (pad_x, pad_y))

    tensor = np.asarray(canvas, dtype=np.float32) / 255.0
    tensor = np.transpose(tensor, (2, 0, 1))[np.newaxis, ...]

    return np.ascontiguousarray(tensor), LetterboxTransform(
        scale=scale, pad_x=pad_x, pad_y=pad_y, original_width=width, original_height=height
    )
