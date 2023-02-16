module.exports = {
    randomHexColor: function() {
        const colors = {
            "Red (Pantone)":"e63946",
            "Honeydew":"f1faee",
            "Non Photo blue":"a8dadc",
            "Cerulean":"457b9d",
            "Berkeley Blue":"1d3557",
            "Eggshell":"f4f1de",
            "Burnt sienna":"e07a5f",
            "Delft Blue":"3d405b",
            "Cambridge blue":"81b29a",
            "Sunset":"f2cc8f",
            "Imperial red":"f94144",
            "Orange (Crayola)":"f3722c",
            "Carrot orange":"f8961e",
            "Coral":"f9844a",
            "Saffron":"f9c74f",
            "Pistachio":"90be6d",
            "Zomp":"43aa8b",
            "Dark cyan":"4d908e",
            "Payne's gray":"577590",
            "Cerulean":"277da1"
        };
        const color = Object.keys(colors)[Math.floor(Math.random() * Object.keys(colors).length)];
        return `#${colors[color].toUpperCase()}`;
    },
};