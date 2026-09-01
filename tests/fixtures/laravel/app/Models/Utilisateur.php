<?php
namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;

class Utilisateur extends Authenticatable
{
    protected $fillable = ['nom', 'email', 'password'];
}
