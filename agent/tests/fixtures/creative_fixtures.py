"""
Reusable CreativePlanDraft fixtures for Step 06 tests.
"""

from typing import Any, Dict


def make_valid_creative_draft_dict(target_video_duration: int = 15) -> Dict[str, Any]:
    # Split scenes dynamically for 15s (3+5+4+3=15) or proportional sum for custom durations
    if target_video_duration == 15:
        durs_a = [3, 5, 4, 3]
        durs_b = [3, 4, 5, 3]
    else:
        base = target_video_duration // 3
        rem = target_video_duration - (base * 3)
        durs_a = [base, base, base + rem]
        durs_b = [base + rem, base, base]

    scenes_a = [
        {
            "scene_number": 1,
            "scene_duration": durs_a[0],
            "opening_hook": "Stop juggling single blenders during hectic morning prep.",
            "scene_description": "Tight overhead opening showing cluttered spice bowls beside the white-and-grey mixer motor base on a warm morning counter.",
            "camera_movement": "Crisp top-down push-in toward the motor unit",
            "product_visibility": "Full top-three-quarter view of white-and-grey body and clear rotary dial",
            "voiceover_script": "Tired of rinsing one blender jar three times every morning?",
            "on_screen_text": "One Jar Slowing You Down?",
            "sound_direction": "Fast crisp kitchen utensil clink synced to rhythmic beat drop",
            "transition_instructions": "Whip pan right into jar attachment reveal",
        },
        {
            "scene_number": 2,
            "scene_duration": durs_a[1],
            "opening_hook": None,
            "scene_description": "Dynamic cut showing all three stainless steel jars (0.35L chutney, 0.8L dry, 1.25L liquidizing) locking cleanly in sequence onto the 500W base.",
            "camera_movement": "Eye-level dolly track left to right past the three jars",
            "product_visibility": "Sharp side profile displaying exact Lifelong logo and locked jar geometry",
            "voiceover_script": "Meet the Lifelong LLM99 500W Mixer Grinder—built with three dedicated stainless steel jars.",
            "on_screen_text": "3 Stainless Steel Jars • 500W",
            "sound_direction": "Satisfying metallic jar lock click with low-end motor hum bed",
            "transition_instructions": "Match-cut rotary dial turn to pulse finish",
        },
        {
            "scene_number": 3,
            "scene_duration": durs_a[2],
            "opening_hook": None,
            "scene_description": "Fingers turn the physical 3-speed rotary knob to pulse; whole green herbs turn into vibrant chutney inside the 0.35L jar while vacuum feet stay steady.",
            "camera_movement": "Macro shallow depth-of-field tilt from rotary knob up to jar lid",
            "product_visibility": "Clear closeup of 3-speed rotary dial and anti-skid base staying firmly anchored",
            "voiceover_script": "Three speeds plus pulse mode power through chutneys and spices effortlessly.",
            "on_screen_text": "3-Speed + Pulse Precision",
            "sound_direction": "Clean whir of grinding blades fading into upbeat acoustic groove",
            "transition_instructions": "Clean dissolve to final plated counter hero shot",
        },
    ]

    if len(durs_a) == 4:
        scenes_a.append({
            "scene_number": 4,
            "scene_duration": durs_a[3],
            "opening_hook": None,
            "scene_description": "Hero end-frame with mixer unit centered beside fresh chutney and spice bowls, displaying INR 1,499 offer and 1 Year Warranty badge in upper-middle safe zone.",
            "camera_movement": "Gentle 5-degree pull-back settle",
            "product_visibility": "Unobstructed front hero view preserving Lifelong branding and clean contours",
            "voiceover_script": "Upgrade your daily kitchen routine for just fourteen ninety-nine. Shop Lifelong today.",
            "on_screen_text": "₹1,499 • 1 Year Brand Warranty",
            "sound_direction": "Warm resolving chord chimes with subtle brand sting",
            "transition_instructions": "End card hold to loop",
        })

    scenes_b = [
        {
            "scene_number": 1,
            "scene_duration": durs_b[0],
            "opening_hook": "Ever watch a cheap mixer wobble across your counter?",
            "scene_description": "Low countertop angle focusing on the base of the appliance sitting motionless during operation beside a glass of water with steady ripples.",
            "camera_movement": "Low-angle static tabletop lock at counter surface height",
            "product_visibility": "Lower housing profile highlighting anti-skid vacuum feet gripped on counter",
            "voiceover_script": "Built for tight apartment counters that cannot handle shaky appliances.",
            "on_screen_text": "Zero Wobble. Firm Vacuum Grip.",
            "sound_direction": "Deep bass thud contrasted with calm steady ambient room tone",
            "transition_instructions": "Speed-ramp upward tilt to front logo panel",
        },
        {
            "scene_number": 2,
            "scene_duration": durs_b[1],
            "opening_hook": None,
            "scene_description": "Cutaway demonstration highlighting the overload protector safety reset engineering and 230V countertop operation during thick dry spice grinding.",
            "camera_movement": "Smooth 45-degree orbital arc around the white-and-grey housing",
            "product_visibility": "Continuous 3/4 view maintaining exact proportions, logo, and power cord connected to wall outlet",
            "voiceover_script": "Powered by a 500W turbo motor with overload protection and a 1-year domestic warranty.",
            "on_screen_text": "500W Turbo + Overload Protector",
            "sound_direction": "Crisp mechanical switch click followed by steady grinding audio",
            "transition_instructions": "Cross-zoom cut to customer rating highlight card",
        },
        {
            "scene_number": 3,
            "scene_duration": durs_b[2],
            "opening_hook": None,
            "scene_description": "Clean studio framing showing 4.3-star rating badge from 156 reviews beside the compact 3-jar setup in an urban apartment kitchen.",
            "camera_movement": "Slow stabilized slide right framing text negative space",
            "product_visibility": "Complete mixer plus nested stainless steel jars in crisp studio light",
            "voiceover_script": "Rated 4.3 stars by real Indian households. Grab yours at 40% off MRP.",
            "on_screen_text": "Rated 4.3★ (156 Reviews) • Save 40%",
            "sound_direction": "Uplifting percussion finish",
            "transition_instructions": "Clean fade out",
        },
    ]

    if len(durs_b) == 4:
        scenes_b.insert(2, {
            "scene_number": 3,
            "scene_duration": durs_b[2],
            "opening_hook": None,
            "scene_description": "Quick side-by-side wipe showing easy rinse cleaning of the removable stainless steel blades and jars after dry masala prep.",
            "camera_movement": "Handheld smooth follow shot moving smoothly toward sink prep zone",
            "product_visibility": "Close focus on stainless steel jar interior finish and detachable lid fit",
            "voiceover_script": "Easy-to-clean steel jars mean less post-dinner cleanup.",
            "on_screen_text": "Effortless Everyday Cleanup",
            "sound_direction": "Crisp water rinse foley blended cleanly into upbeat beat",
            "transition_instructions": "Snap cut to studio end card",
        })
        scenes_b[3]["scene_number"] = 4
        scenes_b[3]["scene_duration"] = durs_b[3]

    return {
        "image_concepts": [
            {
                "concept_id": "img_c1",
                "creative_title": "Three-Jar Culinary Flatlay Blueprint",
                "marketing_angle_id": "angle_1",
                "marketing_angle_name": "Three-Jar Precision for Daily Indian Prep",
                "audience_hypothesis": "Busy Urban Home Cooks who juggle morning smoothies, fresh chutneys, and spice masalas in compact kitchens.",
                "creative_objective": "Drive consideration among urban home cooks by visually proving 3-jar versatility in one compact footprint.",
                "creative_direction_summary": "Overhead editorial culinary flatlay showcasing all three stainless steel jars with fresh ingredients radiating around the motor unit.",
                "hook": "Three dedicated stainless steel jars—zero morning kitchen chaos.",
                "main_message": "Switch seamlessly between 0.35L chutney, 0.8L dry spice, and 1.25L liquidizing prep with a reliable 500W motor.",
                "visual_composition": "Elevated 60-degree editorial flatlay grouping the white-and-grey mixer center-left with the 0.35L, 0.8L, and 1.25L jars arranged along a leading diagonal surrounded by whole coriander, ginger, and berries.",
                "background_direction": "Matte warm slate culinary prep stone lit by directional morning window shadows and crisp negative space at top.",
                "lighting_direction": "Soft warm directional morning window key light from left (4500K) paired with subtle white bounce fill to keep metallic jar highlights crisp.",
                "product_positioning": "Motor base upright center-left connected cleanly to countertop; lids placed neatly beside filled steel jars.",
                "camera_perspective": "60-degree high-angle editorial culinary perspective, 50mm prime lens, f/5.6 sharp front-to-back focus.",
                "placement": "instagram_feed",
                "style_tags": ["editorial culinary flatlay", "morning kitchen aesthetic", "natural light"],
                "extra_negative_instructions": ["messy spills hiding logo", "overcrowded dishware"],
            },
            {
                "concept_id": "img_c2",
                "creative_title": "Industrial Torque & Safety Cutaway Studio Shot",
                "marketing_angle_id": "angle_2",
                "marketing_angle_name": "Built-In Safety & Compact Power",
                "audience_hypothesis": "First-Apartment Young Professionals worried about motor burnout and cheap counter-wobbling appliances.",
                "creative_objective": "Build trust in Lifelong engineering reliability and convert value-conscious buyers at INR 1,499.",
                "creative_direction_summary": "Low-angle architectural hero shot emphasizing the rotary dial control, overload protector engineering, and vacuum foot stability.",
                "hook": "Compact countertop power locked tight with anti-skid vacuum feet.",
                "main_message": "Engineered with a 500W motor, overload protector, and 1-year Lifelong warranty—now at ₹1,499 (40% off MRP).",
                "visual_composition": "Dramatic hero three-quarter silhouette anchored lower-center with bold geometric specification callouts floating cleanly in upper dark-slate breathing space.",
                "background_direction": "Minimal architectural charcoal-grey matte studio cyclorama with soft rim separation.",
                "lighting_direction": "Crisp studio softbox key at 35 degrees plus cool silver rim light outlining stainless steel jar rims and rotary dial contours.",
                "product_positioning": "Hero front-right angle highlighting legible Lifelong wordmark, tactile rotary switch, and visible vacuum feet flush on matte base.",
                "camera_perspective": "Slightly low 15-degree upward architectural hero angle on 85mm macro lens.",
                "placement": "instagram_feed",
                "style_tags": ["architectural product hero", "studio rim lighting", "minimalist value badge"],
                "extra_negative_instructions": ["motion blur on rotary dial", "harsh plastic reflections"],
            },
        ],
        "video_concepts": [
            {
                "concept_id": "vid_c1",
                "creative_title": "15s Morning Kitchen Workflow Transformation",
                "marketing_angle_id": "angle_1",
                "marketing_angle_name": "Three-Jar Precision for Daily Indian Prep",
                "audience_hypothesis": "Busy Urban Home Cooks wanting faster everyday Indian cooking cleanup.",
                "video_objective": "Stop scroll in Instagram Reels by contrasting cluttered prep with rapid 3-jar transformation.",
                "creative_direction_summary": "Fast-cut sensory kitchen workflow transitioning cleanly across morning chutney, spice, and smoothie prep.",
                "total_duration": target_video_duration,
                "placement": "instagram_reels",
                "opening_hook": "Stop juggling single blenders during hectic morning prep.",
                "scene_sequence": scenes_a,
                "final_cta": "Shop Lifelong LLM99 — ₹1,499",
                "style_tags": ["fast sensory reel", "indian home cooking", "vertical 9:16"],
                "extra_negative_instructions": ["flickering jar labels", "missing lid during blend"],
            },
            {
                "concept_id": "vid_c2",
                "creative_title": "15s Counter-Lock Durability Proof Reel",
                "marketing_angle_id": "angle_2",
                "marketing_angle_name": "Built-In Safety & Compact Power",
                "audience_hypothesis": "First-Apartment Young Professionals comparing compact budget mixer durability.",
                "video_objective": "Demonstrate physical countertop stability, 4.3-star social proof, and 40% value offer on Reels.",
                "creative_direction_summary": "Product-proof tabletop test contrasting steady vacuum-foot grip and water-glass stability against social proof.",
                "total_duration": target_video_duration,
                "placement": "instagram_reels",
                "opening_hook": "Ever watch a cheap mixer wobble across your counter?",
                "scene_sequence": scenes_b,
                "final_cta": "Claim 40% Off Today",
                "style_tags": ["durability proof demo", "tabletop macro", "social proof overlay"],
                "extra_negative_instructions": ["floating appliance", "battery icon overlay"],
            },
        ],
        "planning_notes": (
            "Created 2 distinct image blueprints for instagram_feed (4:5) and 2 time-exact 15s video storyboards "
            "for instagram_reels (9:16), strictly preserving corded 230V 500W specs and 3-jar proportions."
        ),
    }

