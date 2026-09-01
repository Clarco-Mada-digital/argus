from django.urls import path
from . import views

urlpatterns = [
    path('archives/', views.archives, name='archives'),
    path('orpheline/', views.page_orpheline, name='orpheline'),
]
