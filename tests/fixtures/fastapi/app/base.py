class Utilisateur:
    id: int
    email: str
    mot_de_passe_hache: str


class _Base:
    def get(self, modele, identifiant):
        return modele()


db = _Base()
