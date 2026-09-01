<?php
namespace App\Http\Controllers;

use App\Models\Produit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProduitController extends Controller
{
    public function index()
    {
        $produits = Produit::all();
        return view('accueil', ['produits' => $produits]);
    }

    public function liste(Request $request)
    {
        $recherche = $request->input('q');
        $produits = DB::select("SELECT * FROM produits WHERE nom LIKE '%" . $recherche . "%'");
        return view('liste', ['produits' => $produits]);
    }

    public function show($id)
    {
        $produit = Produit::find($id);
        // Probleme N+1 : une requete par avis
        foreach ($produit->avis as $avis) {
            $auteur = Utilisateur::find($avis->utilisateur_id);
            echo $auteur->nom;
        }
        return view('detail', ['produit' => $produit]);
    }

    public function commander(Request $request)
    {
        // Affectation de masse : le client peut forcer n'importe quel champ
        $commande = Commande::create($request->all());
        $cle = env('STRIPE_KEY');
        return redirect($request->input('retour'));
    }

    public function promos()
    {
        return view('promos');
    }
}
