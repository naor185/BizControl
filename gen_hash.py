from argon2 import PasswordHasher
ph = PasswordHasher()
h = ph.hash("bef9pqhiodm")
print(f"UPDATE users SET password_hash = '{h}' WHERE email = 'naor185ph@gmail.com';")
