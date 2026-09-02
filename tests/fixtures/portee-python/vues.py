from django.db import connection


def profil(request):
    """Vraie injection : la valeur vient de la requete."""
    identifiant = request.GET.get('id')
    connection.cursor().execute("SELECT * FROM users WHERE id = " + identifiant)


def par_role(request):
    """Constante litterale : rien a signaler."""
    role = 'admin'
    connection.cursor().execute("SELECT * FROM users WHERE role = " + role)


def par_table(nom_table):
    """Parametre : l'appelant est inconnu, la confiance doit baisser."""
    connection.cursor().execute("SELECT * FROM " + nom_table)


class Recherche:
    def executer(self, request):
        # Reaffectation : sure a la declaration, empoisonnee ensuite.
        critere = 'defaut'
        critere = request.POST.get('critere')
        connection.cursor().execute("SELECT * FROM users WHERE nom = " + critere)
