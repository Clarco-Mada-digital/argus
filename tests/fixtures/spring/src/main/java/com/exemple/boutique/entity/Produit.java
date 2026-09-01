package com.exemple.boutique.entity;

import javax.persistence.*;

@Entity
public class Produit {
    @Id @GeneratedValue
    private Long id;
    private String nom;

    @OneToMany(mappedBy = "produit")
    private java.util.List<Avis> avis;

    public Long getId() { return id; }
    public String getNom() { return nom; }
}
