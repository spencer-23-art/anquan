from __future__ import annotations

from io import BytesIO
import warnings

from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from app.config import settings

IMAGE_EXTENSIONS = {
    "JPEG": "jpg",
    "PNG": "png",
    "WEBP": "webp",
}
Image.MAX_IMAGE_PIXELS = 20_000_000


def validate_image_content(content: bytes) -> tuple[bytes, str]:
    """Validate image bytes and return a safe extension determined from content."""
    if not content:
        raise ValueError("Image file is empty")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                image_format = image.format
                image.verify()
            with Image.open(BytesIO(content)) as image:
                image.load()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("Image dimensions are too large") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("Uploaded file is not a valid image") from exc

    extension = IMAGE_EXTENSIONS.get(image_format or "")
    if not extension:
        raise ValueError("Only JPEG, PNG, and WebP images are supported")
    return content, extension


async def read_image_upload(upload: UploadFile) -> tuple[bytes, str]:
    if upload.content_type and not upload.content_type.lower().startswith("image/"):
        raise HTTPException(status_code=400, detail="Photo must be an image")

    content = await upload.read(settings.MAX_UPLOAD_SIZE + 1)
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Upload too large. Max {settings.MAX_UPLOAD_SIZE // 1024 // 1024}MB",
        )

    try:
        return validate_image_content(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
