<?php
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ProduitController;

Route::get('/', [ProduitController::class, 'index'])->name('accueil');
Route::get('/produits', [ProduitController::class, 'liste'])->name('produits.liste');
Route::get('/produits/{id}', [ProduitController::class, 'show'])->name('produits.detail');
Route::post('/commander', [ProduitController::class, 'commander'])->name('commander');
Route::get('/Promotions', [ProduitController::class, 'promos'])->name('promotions');
