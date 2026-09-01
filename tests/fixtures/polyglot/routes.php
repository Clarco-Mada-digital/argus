<?php
Route::get('/', 'HomeController@index');
Route::post('/connexion', 'AuthController@login');
Route::get('/produits/{id}', 'ProduitController@show');

$query = "SELECT * FROM users WHERE email = '" . $_GET['email'] . "'";
$data = unserialize($_POST['payload']);
$hash = md5($_POST['password']);
echo shell_exec("ls " . $_GET['dir']);
