"""Domain exceptions.

Each carries a machine-readable code the API turns into a stable error body,
and a Thai user-facing message — the reps who read these are Thai speakers,
and an English stack trace on a phone in a shop aisle helps nobody.
"""

from __future__ import annotations


class ShelfEyeError(Exception):
    code = "INTERNAL_ERROR"
    http_status = 500
    user_message = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"

    def __init__(self, detail: str = "", **context: object) -> None:
        super().__init__(detail or self.code)
        self.detail = detail or self.code
        self.context = context


class NotFoundError(ShelfEyeError):
    code = "NOT_FOUND"
    http_status = 404
    user_message = "ไม่พบข้อมูลที่ต้องการ"


class ValidationError(ShelfEyeError):
    code = "VALIDATION_ERROR"
    http_status = 422
    user_message = "ข้อมูลไม่ถูกต้อง"


class PermissionDeniedError(ShelfEyeError):
    code = "PERMISSION_DENIED"
    http_status = 403
    user_message = "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้"


class PhotoPolicyError(PermissionDeniedError):
    code = "PHOTO_FORBIDDEN"
    user_message = "ร้านนี้ไม่อนุญาตให้ถ่ายภาพ"


class NoShelfDetectedError(ShelfEyeError):
    """The model returned nothing usable.

    This is emphatically NOT a perfect shelf. Reporting OSA 100% for a photo of
    the ceiling would quietly destroy the dataset's credibility, so this is a
    hard error that sends the rep back to retake the photo.
    """

    code = "NO_SHELF_DETECTED"
    http_status = 422
    user_message = "ไม่พบชั้นวางในภาพ กรุณาถ่ายใหม่โดยให้เห็นชั้นวางเต็มภาพ"


class UnreadableImageError(ShelfEyeError):
    code = "UNREADABLE_IMAGE"
    http_status = 422
    user_message = "ภาพไม่ชัดหรือเสียหาย กรุณาถ่ายใหม่"


class MLServiceError(ShelfEyeError):
    """Transient ML-side failure. Retryable, unlike the two above."""

    code = "ML_SERVICE_UNAVAILABLE"
    http_status = 503
    user_message = "ระบบวิเคราะห์ไม่พร้อมใช้งานชั่วคราว กำลังลองใหม่"
