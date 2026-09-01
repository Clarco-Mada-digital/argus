from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from .base import db, Utilisateur

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/utilisateurs/{identifiant}")
async def lire_utilisateur(identifiant: int):
    return db.get(Utilisateur, identifiant)


@app.get("/sante")
async def sante():
    return {"statut": "ok"}
