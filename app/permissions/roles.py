from enum import Enum


class UserRole(str, Enum):

    owner = "owner"
    admin = "admin"
    artist = "artist"
    staff = "staff"
