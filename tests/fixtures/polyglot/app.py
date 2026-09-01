import os
import subprocess
import pickle
from flask import Flask, request, redirect

app = Flask(__name__)
app.config['SECRET_KEY'] = 'aB3xK9mQ7pL2vN8wR4tY6uZ1cD5eF0gH'

@app.route('/')
def home():
    return "Accueil"

@app.route('/search', methods=['GET', 'POST'])
def search():
    terme = request.args.get('q')
    cur.execute("SELECT * FROM produits WHERE nom = '" + terme + "'")
    subprocess.run("grep " + terme + " data.txt", shell=True)
    return redirect(request.args.get('next'))

@app.route('/admin/dashboard')
def admin():
    data = pickle.loads(request.data)
    return data

def fonction_jamais_appelee(a, b, c, d, e, f, g):
    if a:
        if b:
            if c:
                if d:
                    return e
    return 0

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')
