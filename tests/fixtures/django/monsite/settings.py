from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = 'django-insecure-k2h9d8f7g6h5j4k3l2m1n0p9q8r7s6t5u4v3w2x1y0z'
DEBUG = True
ALLOWED_HOSTS = ['*']

INSTALLED_APPS = ['django.contrib.admin', 'django.contrib.auth', 'blog']

MIDDLEWARE = [
    'django.middleware.common.CommonMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
]

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'prod',
        'USER': 'admin',
        'PASSWORD': 'SuperSecret2024!',
        'HOST': 'db.exemple.com',
    }
}

SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
STATIC_URL = 'static/'
