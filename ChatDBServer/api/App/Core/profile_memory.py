"""Model helpers for reading persisted user profile memory."""


class UserProfileMemoryMixin:
    """Expose normalized profile memory to the model prompt builder."""

    def _get_user_profile_memory_text(self) -> str:
        """Return only stored profile content, without application permissions."""

        profile = self.user.get_user_profile_memory(max_chars=0)

        return str(profile or "").strip()
