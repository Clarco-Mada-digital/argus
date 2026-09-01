import os
from flask import Flask, request, send_from_directory, render_template

app = Flask(__name__)
app.secret_key = 'ma-clef-de-session-tres-secrete-2024'


@app.route('/')
def accueil():
    return render_template('accueil.html')


@app.route('/contact', methods=['GET', 'POST'])
def contact():
    if request.method == 'POST':
        enregistrer(request.form.get('message'))
    return render_template('contact.html')


@app.route('/fichier')
def fichier():
    return send_from_directory('documents', request.args.get('nom'))


def enregistrer(message):
    return message
