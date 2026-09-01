from django.db import models


class Article(models.Model):
    titre = models.CharField(max_length=200)
    contenu = models.TextField()
    resume = models.CharField(max_length=300, null=True, blank=True)
    publie = models.BooleanField(default=False)


class Commentaire(models.Model):
    article = models.ForeignKey(Article, on_delete=models.CASCADE)
    auteur = models.CharField(max_length=100)
    texte = models.TextField()
