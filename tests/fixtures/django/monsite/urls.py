from django.contrib import admin
from django.urls import path, include
from blog import views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', views.accueil, name='accueil'),
    path('articles/', views.ArticleListView.as_view(), name='liste-articles'),
    path('articles/<int:pk>/', views.detail_article, name='detail-article'),
    path('recherche/', views.recherche, name='recherche'),
    path('Contact/', views.contact, name='contact'),
    path('blog/', include('blog.urls')),
]
