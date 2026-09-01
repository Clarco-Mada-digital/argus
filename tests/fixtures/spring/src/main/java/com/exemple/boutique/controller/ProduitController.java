package com.exemple.boutique.controller;

import org.springframework.web.bind.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.List;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ProduitController {

    private final JdbcTemplate jdbc;

    public ProduitController(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @GetMapping("/produits")
    public List<String> liste(@RequestParam String recherche) {
        return jdbc.queryForList(
            "SELECT * FROM produits WHERE nom LIKE '%" + recherche + "%'", String.class);
    }

    @GetMapping("/Promotions")
    public String promotions() { return "[]"; }

    @PostMapping("/commander")
    public String commander(@RequestBody String corps) {
        return "ok";
    }
}
