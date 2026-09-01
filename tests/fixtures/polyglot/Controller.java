package com.exemple;

import org.springframework.web.bind.annotation.*;
import java.io.ObjectInputStream;

@RestController
@RequestMapping("/api")
public class Controller {
    private static final String API_KEY = "AKIAIOSFODNN7EXAMPLE";

    @GetMapping("/utilisateurs")
    public String liste() { return "[]"; }

    @PostMapping("/utilisateurs")
    public String creer(@RequestBody String body) throws Exception {
        Object o = new ObjectInputStream(null).readObject();
        Runtime.getRuntime().exec("sh -c " + body);
        return "ok";
    }
}
