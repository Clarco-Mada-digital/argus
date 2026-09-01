import pickle
import hashlib
from django.db import connection
from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import render
from django.views.generic import ListView
from django.views.decorators.csrf import csrf_exempt
from django.utils.safestring import mark_safe
from .models import Article, Commentaire


def accueil(request):
    articles = Article.objects.all()
    return render(request, 'blog/accueil.html', {'articles': articles})


class ArticleListView(ListView):
    model = Article
    template_name = 'blog/liste.html'


def detail_article(request, pk):
    article = Article.objects.get(pk=pk)
    # Probleme N+1 : une requete par commentaire
    for commentaire in article.commentaire_set.all():
        auteur = Commentaire.objects.get(pk=commentaire.pk).auteur
        print(auteur)
    return render(request, 'blog/detail.html', {'article': article})


def recherche(request):
    terme = request.GET.get('q')
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM blog_article WHERE titre LIKE '%" + terme + "%'")
        resultats = cursor.fetchall()
    html = mark_safe("<h2>Resultats pour " + terme + "</h2>")
    return HttpResponse(html)


@csrf_exempt
def contact(request):
    donnees = pickle.loads(request.body)
    empreinte = hashlib.md5(request.POST.get('email', '').encode()).hexdigest()
    return HttpResponseRedirect(request.GET.get('next'))


def archives(request):
    articles = Article.objects.raw("SELECT * FROM blog_article WHERE annee = %s" % request.GET.get('annee'))
    return render(request, 'blog/archives.html', {'articles': articles})


def page_orpheline(request):
    return render(request, 'blog/orpheline.html', {})
