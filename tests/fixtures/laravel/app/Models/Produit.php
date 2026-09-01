<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Produit extends Model
{
    protected $guarded = [];

    public function avis()
    {
        return $this->hasMany(Avis::class);
    }
}
