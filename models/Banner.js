const mongoose = require("mongoose");


const BannerSchema = new mongoose.Schema({
    familyKey:{type:String,required:true},
    imageUrl:{type:String,required:true},
    text:{type:String,required:true},
    createdAt:{type:Date,default:Date.now}
})

module.exports=mongoose.model("Banner",BannerSchema)